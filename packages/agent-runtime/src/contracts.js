/**
 * Neutral runtime contract notes:
 *
 * - Public primitives are session + run, not provider-native thread/turn names.
 * - Inputs are typed arrays from day one.
 * - Runtime output is one unified event stream, replayable by cursor.
 * - Approvals travel in the same event history and are answered via runtime APIs.
 * - Persistence is provided by the host application through the RuntimeStore interface.
 */

export const sessionStatuses = Object.freeze([
  'idle',
  'running',
  'waiting_for_approval',
  'completed',
  'failed',
  'archived'
]);

export const runStatuses = Object.freeze([
  'queued',
  'running',
  'waiting_for_approval',
  'interrupted',
  'completed',
  'failed'
]);

export const approvalDecisionTypes = Object.freeze([
  'approve',
  'approve_for_session',
  'reject',
  'cancel',
  'approve_with_changes'
]);

export function assertTypedInputArray(input) {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error('Runtime input must be a non-empty array of typed items.');
  }

  for (const item of input) {
    if (!item || typeof item !== 'object' || typeof item.type !== 'string') {
      throw new Error('Each runtime input item must have a string type.');
    }
  }
}

export function assertApprovalDecision(decision) {
  if (!decision || typeof decision !== 'object' || !approvalDecisionTypes.includes(decision.type)) {
    throw new Error('Approval decision type is invalid.');
  }
}
