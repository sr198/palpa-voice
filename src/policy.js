import { PATCH_RISK } from './contracts.js';

const ALLOWED_PREFIXES = {
  curator: [
    '/conversationState/',
    '/outputs/openQuestions',
    '/outputs/risks',
    '/outputs/decisions'
  ],
  human: ['/'],
  codex: ['/outputs/codexFindings', '/outputs/workItems', '/outputs/architectureNotes'],
  supervisor: ['/agentRuns', '/contextPacks']
};

export function isPathAllowed(producerType, path) {
  const prefixes = ALLOWED_PREFIXES[producerType] || [];
  return prefixes.some((prefix) => path.startsWith(prefix));
}

export function requiresHumanReview(proposal) {
  if (proposal.risk === PATCH_RISK.HIGH) return true;
  if (proposal.risk === PATCH_RISK.MEDIUM) return true;
  if (proposal.operations.some((op) => op.path.startsWith('/outputs/decisions'))) return true;
  return false;
}

export function policyRejectReason(proposal) {
  for (const op of proposal.operations) {
    if (!isPathAllowed(proposal.producer.type, op.path)) {
      return `producer ${proposal.producer.type} cannot write to ${op.path}`;
    }
    if (op.path.includes('/locked') || op.path.includes('/confirmed')) {
      return `locked or confirmed decision state cannot be set by ${proposal.producer.type}`;
    }
  }
  return null;
}
