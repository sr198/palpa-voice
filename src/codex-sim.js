export function simulateCodexRun({ session, contextPack }) {
  const evidenceRefs = contextPack.rawTranscriptExcerpts.map((item) => item.evidenceRef).slice(0, 3);
  const findings = [];

  const suggestions = [];
  if (!session.outputs.risks.length) {
    suggestions.push('Capture at least one explicit handoff risk before real Codex/MCP integration.');
  }
  if (!session.outputs.openQuestions.length) {
    suggestions.push('Add one concrete validation question for the first real Codex run.');
  }
  if (!session.outputs.decisions.length) {
    suggestions.push('Approve at least one decision candidate so the first context pack includes stable guidance.');
  }

  findings.push({
    title: 'Lean Codex handoff is viable',
    summary: 'A bounded pack with current topic, summary, limited artifacts, and evidence-linked transcript excerpts is enough for the first external agent handoff.',
    evidenceRefs
  });

  if (suggestions.length) {
    findings.push({
      title: 'Next governance gaps to close',
      summary: suggestions.join(' '),
      evidenceRefs
    });
  }

  return {
    summary: 'Simulated Codex review completed with governed findings only.',
    findings,
    evidenceRefs,
    operations: [
      {
        op: 'add',
        path: '/outputs/codexFindings/-',
        value: {
          id: `FIND-${Date.now()}`,
          title: 'Lean Codex handoff validated',
          summary: suggestions.length
            ? `The current context pack is sufficient for a first handoff. Follow-ups: ${suggestions.join(' ')}`
            : 'The current context pack is sufficient for a first handoff.',
          evidenceRefs
        }
      }
    ]
  };
}
