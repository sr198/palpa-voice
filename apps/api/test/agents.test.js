import test from 'node:test';
import assert from 'node:assert/strict';

import { createFallbackAgentReply, listAgents, resolveAgent } from '../src/agents.js';

test('agent registry exposes the expected voice roles', () => {
  const agents = listAgents();

  assert.equal(agents.length, 4);
  assert.equal(agents[0].id, 'architect');
  assert.equal(agents[2].id, 'voice-lead');
});

test('unknown target agent falls back to architect metadata', () => {
  const agent = resolveAgent('missing-agent');
  assert.equal(agent.id, 'architect');
});

test('fallback reply includes provider metadata and voice split', () => {
  const reply = createFallbackAgentReply({
    targetAgentId: 'frontend',
    transcript: 'How should the browser present spoken vs artifact output?',
    error: 'codex unavailable'
  });

  assert.equal(reply.agent.id, 'frontend');
  assert.equal(reply.provider, 'codex-fallback');
  assert.equal(reply.mode, 'fallback');
  assert.equal(reply.threadId, null);
  assert.match(reply.spokenText, /Frontend fallback:/);
  assert.match(reply.artifactText, /codex unavailable/);
});
