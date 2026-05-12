import { EventEmitter } from 'node:events';
import {
  createSession,
  createTranscriptEvent,
  EVENT_TYPES,
  PATCH_STATUS,
  PATCH_RISK,
  validatePatchProposal
} from './contracts.js';
import { policyRejectReason, requiresHumanReview } from './policy.js';
import { curateTranscriptEvent } from './curator.js';
import { buildCodexContextPack } from './context-builder.js';
import { simulateCodexRun } from './codex-sim.js';

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
      pendingPatches: deepClone(this.pendingPatches),
      codexContextPack: deepClone(this.session.contextPacks.codex || null)
    };
  }

  emitProjection() {
    this.emitter.emit('projection');
  }

  addAuditPatch(entry) {
    this.session.audit.patchLog.unshift(entry);
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
      this.addAuditPatch({
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
    this.addAuditPatch({
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
    this.addAuditPatch(item);
    this.emitProjection();
    return item;
  }

  reviewPatch(id, decision) {
    const index = this.pendingPatches.findIndex((patch) => patch.id === id);
    if (index === -1) return null;
    const [patch] = this.pendingPatches.splice(index, 1);

    if (decision === 'approve') {
      const result = this.applyAcceptedPatch({ ...patch, desiredApplyMode: 'auto' });
      this.addAuditPatch({
        id: patch.id,
        type: EVENT_TYPES.SESSION_PATCH_REVIEWED,
        status: PATCH_STATUS.ACCEPTED,
        reason: 'Approved by human reviewer',
        createdAt: new Date().toISOString()
      });
      this.emitProjection();
      return result;
    }

    this.addAuditPatch({
      id: patch.id,
      type: EVENT_TYPES.SESSION_PATCH_REVIEWED,
      status: PATCH_STATUS.REJECTED,
      reason: 'Rejected by human reviewer',
      createdAt: new Date().toISOString()
    });
    this.emitProjection();
    return { ...patch, status: PATCH_STATUS.REJECTED };
  }

  updateAgentRun(agentRunId, updates) {
    const run = this.session.agentRuns.find((item) => item.id === agentRunId);
    if (!run) return null;
    Object.assign(run, updates, { updatedAt: new Date().toISOString() });
    this.session.updatedAt = new Date().toISOString();
    this.emitProjection();
    return run;
  }

  startCodexRun(task = 'Review the current session and suggest the next lean changes.') {
    const contextPack = buildCodexContextPack(this.session);
    this.session.contextPacks.codex = contextPack;

    const agentRun = {
      id: `COD-${Date.now()}`,
      agent: 'codex',
      status: 'running',
      task,
      contextPackId: contextPack.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      resultSummary: null
    };
    this.session.agentRuns.unshift(agentRun);
    this.session.updatedAt = new Date().toISOString();
    this.emitProjection();

    const result = simulateCodexRun({ session: this.session, contextPack });
    this.updateAgentRun(agentRun.id, {
      status: 'completed',
      resultSummary: result.summary,
      findingsCount: result.findings.length
    });

    const proposal = {
      id: `patch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sessionId: this.session.id,
      producer: {
        type: 'codex',
        id: 'codex-sim'
      },
      reason: `Codex run ${agentRun.id} proposed lean session updates`,
      confidence: 0.78,
      evidenceRefs: result.evidenceRefs,
      operations: result.operations,
      risk: PATCH_RISK.MEDIUM,
      desiredApplyMode: 'human_review'
    };

    const patchResult = this.proposePatch(proposal);
    return {
      agentRun: deepClone(this.session.agentRuns.find((run) => run.id === agentRun.id)),
      contextPack: deepClone(contextPack),
      patchResult,
      findings: result.findings
    };
  }
}
