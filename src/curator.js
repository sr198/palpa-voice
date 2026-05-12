import { PATCH_RISK } from './contracts.js';

function pickActiveTopic(text) {
  const lower = text.toLowerCase();
  if (lower.includes('voice')) return 'Voice-first collaboration flow';
  if (lower.includes('event')) return 'Event-based collaboration loop';
  if (lower.includes('codex')) return 'Codex agent integration';
  if (lower.includes('schema') || lower.includes('contract')) return 'Lean contracts and session shape';
  return 'POC planning';
}

function classify(text) {
  const lower = text.toLowerCase();
  if (lower.includes('?')) return 'open_question';
  if (lower.includes('risk') || lower.includes('failure') || lower.includes('fail')) return 'risk';
  if (lower.includes('should') || lower.includes('must') || lower.includes('need')) return 'decision_candidate';
  if (lower.includes('hello') || lower.includes('thanks')) return 'small_talk';
  return 'context';
}

function makeRollingSummary(session, text) {
  const previous = session.conversationState.rollingSummary;
  const line = text.length > 140 ? `${text.slice(0, 137)}...` : text;
  const next = previous === 'Session started.' ? line : `${previous}\n- ${line}`;
  return next.split('\n').slice(-6).join('\n');
}

export function curateTranscriptEvent(session, event) {
  const kind = classify(event.text);
  const activeTopic = pickActiveTopic(event.text);
  const evidenceRef = `transcript://${session.id}/${event.id}`;
  const operations = [
    {
      op: 'replace',
      path: '/conversationState/activeTopic',
      value: activeTopic
    },
    {
      op: 'replace',
      path: '/conversationState/rollingSummary',
      value: makeRollingSummary(session, event.text)
    },
    {
      op: 'replace',
      path: '/conversationState/usefulContextSummary',
      value: `Current focus: ${activeTopic}`
    }
  ];

  let risk = PATCH_RISK.LOW;
  let reason = `Curated transcript event as ${kind}`;

  if (kind === 'open_question') {
    operations.push({
      op: 'add',
      path: '/outputs/openQuestions/-',
      value: {
        id: `Q-${Date.now()}`,
        text: event.text,
        status: 'open',
        evidenceRefs: [evidenceRef]
      }
    });
    risk = PATCH_RISK.LOW;
  } else if (kind === 'risk') {
    operations.push({
      op: 'add',
      path: '/outputs/risks/-',
      value: {
        id: `RISK-${Date.now()}`,
        title: event.text,
        severity: 'medium',
        evidenceRefs: [evidenceRef]
      }
    });
    risk = PATCH_RISK.LOW;
  } else if (kind === 'decision_candidate') {
    operations.push({
      op: 'add',
      path: '/outputs/decisions/-',
      value: {
        id: `DEC-${Date.now()}`,
        text: event.text,
        status: 'candidate',
        evidenceRefs: [evidenceRef]
      }
    });
    risk = PATCH_RISK.MEDIUM;
  }

  return {
    id: `patch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sessionId: session.id,
    producer: {
      type: 'curator',
      id: 'conversation-curator'
    },
    reason,
    confidence: 0.72,
    evidenceRefs: [evidenceRef],
    operations,
    risk,
    desiredApplyMode: risk === PATCH_RISK.LOW ? 'auto' : 'human_review'
  };
}
