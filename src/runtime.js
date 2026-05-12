import { EventEmitter } from 'node:events';
import {
  createSession,
  createTranscriptEvent,
  EVENT_TYPES,
  PATCH_STATUS,
  validatePatchProposal
} from './contracts.js';
import { policyRejectReason, requiresHumanReview } from './policy.js';
import { curateTranscriptEvent } from './curator.js';

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function parsePath(path) {
  return path.split('/').slice(1);
}

function applyOperation(target, operation) {
  const parts = parsePath(operation.path);
  const last = parts.pop();
  let node = target;
  for (const part of parts) {
    if (!(part in node)) node[part] = {};
    node = node[part];
  }

  if (last === '-') {
    if (!Array.isArray(node)) throw new Error(`Path ${operation.path} is not appendable`);
    node.push(operation.value);
    return;
  }

  if (operation.op === 'remove') {
    if (Array.isArray(node)) {
      node.splice(Number(last), 1);
    } else {
      delete node[last];
    }
    return;
  }

  if (Array.isArray(node) && /^\d+$/.test(last)) {
    node[Number(last)] = operation.value;
  } else {
    node[last] = operation.value;
  }
}

export class SessionRuntime {
  constructor() {
    this.emitter = new EventEmitter();
    this.session = createSession();
    this.pendingPatches = [];
  }

  subscribe(listener) {
    const wrapped = () => listener(this.getProjection());
    this.emitter.on('projection', wrapped);
    wrapped();
    return () => this.emitter.off('projection', wrapped);
  }

  getProjection() {
    return {
      session: deepClone(this.session),
      pendingPatches: deepClone(this.pendingPatches)
    };
  }

  emitProjection() {
    this.emitter.emit('projection');
  }

  ingestMessage({ speaker, text }) {
    const event = createTranscriptEvent({ sessionId: this.session.id, speaker, text });
    this.session.transcript.full.push(event);
    this.session.transcript.latestUtteranceIds = [event.id];
    this.session.audit.eventLog.push(event);
    const proposal = curateTranscriptEvent(this.session, event);
    return this.proposePatch(proposal, event);
  }

  proposePatch(proposal, sourceEvent = null) {
    const schemaError = validatePatchProposal(proposal);
    if (schemaError) {
      return this.rejectPatch(proposal, schemaError, sourceEvent);
    }

    const policyError = policyRejectReason(proposal);
    if (policyError) {
      return this.rejectPatch(proposal, policyError, sourceEvent);
    }

    if (requiresHumanReview(proposal)) {
      const pending = {
        ...proposal,
        status: PATCH_STATUS.NEEDS_REVIEW,
        createdAt: new Date().toISOString(),
        sourceEventId: sourceEvent?.id || null
      };
      this.pendingPatches.unshift(pending);
      this.session.audit.patchLog.unshift({
        id: proposal.id,
        type: EVENT_TYPES.SESSION_PATCH_PROPOSED,
        status: PATCH_STATUS.NEEDS_REVIEW,
        reason: proposal.reason,
        createdAt: pending.createdAt
      });
      this.emitProjection();
      return pending;
    }

    return this.applyAcceptedPatch(proposal, sourceEvent);
  }

  applyAcceptedPatch(proposal, sourceEvent = null) {
    const next = deepClone(this.session);
    for (const operation of proposal.operations) {
      applyOperation(next, operation);
    }
    next.version += 1;
    next.updatedAt = new Date().toISOString();
    next.transcript.lastCuratedAt = next.updatedAt;
    this.session = next;
    this.session.audit.patchLog.unshift({
      id: proposal.id,
      type: EVENT_TYPES.SESSION_PATCH_APPLIED,
      status: PATCH_STATUS.ACCEPTED,
      reason: proposal.reason,
      createdAt: next.updatedAt,
      sourceEventId: sourceEvent?.id || null
    });
    this.emitProjection();
    return { ...proposal, status: PATCH_STATUS.ACCEPTED };
  }

  rejectPatch(proposal, reason, sourceEvent = null) {
    const item = {
      id: proposal?.id || `patch-${Date.now()}`,
      type: EVENT_TYPES.SESSION_PATCH_PROPOSED,
      status: PATCH_STATUS.REJECTED,
      reason,
      createdAt: new Date().toISOString(),
      sourceEventId: sourceEvent?.id || null
    };
    this.session.audit.patchLog.unshift(item);
    this.emitProjection();
    return item;
  }

  reviewPatch(id, decision) {
    const index = this.pendingPatches.findIndex((patch) => patch.id === id);
    if (index === -1) return null;
    const [patch] = this.pendingPatches.splice(index, 1);

    if (decision === 'approve') {
      const result = this.applyAcceptedPatch({ ...patch, desiredApplyMode: 'auto' });
      this.session.audit.patchLog.unshift({
        id: patch.id,
        type: EVENT_TYPES.SESSION_PATCH_REVIEWED,
        status: PATCH_STATUS.ACCEPTED,
        reason: 'Approved by human reviewer',
        createdAt: new Date().toISOString()
      });
      this.emitProjection();
      return result;
    }

    this.session.audit.patchLog.unshift({
      id: patch.id,
      type: EVENT_TYPES.SESSION_PATCH_REVIEWED,
      status: PATCH_STATUS.REJECTED,
      reason: 'Rejected by human reviewer',
      createdAt: new Date().toISOString()
    });
    this.emitProjection();
    return { ...patch, status: PATCH_STATUS.REJECTED };
  }
}
