export const PATCH_RISK = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high'
};

export const DECISION_STATUS = {
  CANDIDATE: 'candidate',
  CONFIRMED: 'confirmed',
  LOCKED: 'locked',
  REJECTED: 'rejected'
};

export const PATCH_STATUS = {
  ACCEPTED: 'accepted',
  NEEDS_REVIEW: 'needs_human_review',
  REJECTED: 'rejected'
};

export const EVENT_TYPES = {
  TRANSCRIPT_FINAL: 'transcript.final',
  SESSION_PATCH_PROPOSED: 'session.patch.proposed',
  SESSION_PATCH_APPLIED: 'session.patch.applied',
  SESSION_PATCH_REVIEWED: 'session.patch.reviewed'
};

export function createSession({ id = 'HUD-001', title = 'Palpa POC Session' } = {}) {
  const now = new Date().toISOString();
  return {
    id,
    title,
    mode: 'planning',
    status: 'active',
    version: 1,
    participants: {
      humans: [{ id: 'human-1', name: 'You' }],
      agents: []
    },
    transcript: {
      full: [],
      latestUtteranceIds: [],
      lastCuratedAt: null
    },
    conversationState: {
      activeTopic: null,
      rollingSummary: 'Session started.',
      usefulContextSummary: 'No curated context yet.',
      discardedNoiseSummary: '',
      unresolvedAmbiguities: []
    },
    outputs: {
      decisions: [],
      openQuestions: [],
      risks: [],
      codexFindings: []
    },
    agentRuns: [],
    contextPacks: {},
    audit: {
      eventLog: [],
      patchLog: []
    },
    createdAt: now,
    updatedAt: now
  };
}

export function createTranscriptEvent({ sessionId, speaker = 'You', text }) {
  return {
    type: EVENT_TYPES.TRANSCRIPT_FINAL,
    id: `utt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sessionId,
    speaker,
    text: String(text || '').trim(),
    timestamp: new Date().toISOString()
  };
}

export function isMaterialPath(path) {
  return (
    path.startsWith('/outputs/') ||
    path.startsWith('/conversationState/activeTopic') ||
    path.startsWith('/conversationState/rollingSummary') ||
    path.startsWith('/conversationState/usefulContextSummary')
  );
}

export function validatePatchProposal(proposal) {
  if (!proposal || typeof proposal !== 'object') return 'Patch must be an object';
  if (!proposal.sessionId) return 'sessionId is required';
  if (!proposal.producer?.type) return 'producer.type is required';
  if (!proposal.producer?.id) return 'producer.id is required';
  if (!Array.isArray(proposal.operations) || proposal.operations.length === 0) {
    return 'operations must be a non-empty array';
  }
  for (const op of proposal.operations) {
    if (!['add', 'replace', 'remove'].includes(op.op)) return `invalid op: ${op.op}`;
    if (typeof op.path !== 'string' || !op.path.startsWith('/')) return 'operation.path must be an absolute path';
  }
  if (proposal.operations.some((op) => isMaterialPath(op.path)) && (!proposal.evidenceRefs || proposal.evidenceRefs.length === 0)) {
    return 'material claims require evidenceRefs';
  }
  return null;
}
