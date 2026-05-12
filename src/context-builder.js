export function buildCodexContextPack(session) {
  const recentTranscript = session.transcript.full.slice(-6).map((item) => ({
    id: item.id,
    speaker: item.speaker,
    text: item.text,
    evidenceRef: `transcript://${session.id}/${item.id}`
  }));

  return {
    id: `CTX-CODEX-${Date.now()}`,
    kind: 'palpa.contextPack',
    version: 1,
    sessionId: session.id,
    targetAgent: 'codex',
    purpose: 'Review the current session and propose the next lean design improvements.',
    currentTopic: session.conversationState.activeTopic,
    sessionSummary: session.conversationState.rollingSummary,
    usefulContextSummary: session.conversationState.usefulContextSummary,
    decisions: session.outputs.decisions.slice(-5),
    openQuestions: session.outputs.openQuestions.slice(-5),
    risks: session.outputs.risks.slice(-5),
    rawTranscriptExcerpts: recentTranscript,
    constraints: [
      'Do not assume the full transcript is your context.',
      'Propose only draft or candidate changes.',
      'Every material finding must reference transcript evidence.'
    ]
  };
}
