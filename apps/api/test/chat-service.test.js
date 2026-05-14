import test from 'node:test';
import assert from 'node:assert/strict';

import { MockAgentProvider, InMemoryRuntimeStore, SessionManager } from '../../../packages/agent-runtime/src/index.js';
import { ChatService } from '../src/chat-service.js';

function createRuntimeFactory(scriptFactory) {
  let runtime;
  return async () => {
    if (!runtime) {
      runtime = new SessionManager({
        provider: new MockAgentProvider({ scriptFactory }),
        store: new InMemoryRuntimeStore(),
        now: (() => {
          let tick = 1000;
          return () => ++tick;
        })(),
        createId: (() => {
          let sessionCount = 0;
          let runCount = 0;
          return (prefix) => {
            if (prefix === 'session') {
              sessionCount += 1;
              return `session_${sessionCount}`;
            }

            runCount += 1;
            return `run_${runCount}`;
          };
        })()
      });
      await runtime.initialize();
    }

    return runtime;
  };
}

test('chat service creates sessions, starts runs, replays history, and resolves approvals', async () => {
  const chat = new ChatService({
    config: {
      codexCwd: '/repo',
      codexModel: 'gpt-test',
      codexApprovalPolicy: 'on-request',
      codexNetworkAccess: true
    },
    runtimeFactory: createRuntimeFactory(({ providerSessionId, providerRunId }) => [
      {
        type: 'approval.requested',
        sessionId: providerSessionId,
        runId: providerRunId,
        approval: {
          id: 'approval_1',
          kind: 'command',
          command: ['npm', 'test'],
          cwd: '/repo',
          availableDecisions: ['approve', 'reject']
        }
      },
      {
        type: 'message.completed',
        sessionId: providerSessionId,
        runId: providerRunId,
        role: 'assistant',
        text: 'Tests are green.'
      },
      {
        type: 'run.completed',
        sessionId: providerSessionId,
        runId: providerRunId,
        status: 'completed'
      }
    ]),
    workspaceFactory: async () => ({
      codex: { configured: true, auth_method: 'chatgpt', cwd: '/repo' },
      skills: [],
      apps: [],
      warning: null
    })
  });

  const session = await chat.createSession({ title: 'Design review', agentId: 'architect' });
  assert.equal(session.agent.id, 'architect');
  assert.equal(session.metadata.model, 'gpt-test');

  const listed = await chat.listSessions();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, session.id);

  const stream = await chat.subscribe(session.id);
  const iterator = stream[Symbol.asyncIterator]();
  const first = await iterator.next();
  assert.equal(first.value.event.type, 'session.created');

  const run = await chat.startRun(session.id, {
    text: 'Inspect the repository.'
  });
  assert.equal(run.session_id, session.id);
  assert.equal(run.agent_id, 'architect');

  const history = await chat.getHistory(session.id);
  assert.ok(history.some((entry) => entry.event.type === 'run.started'));

  await chat.respondToApproval(session.id, run.id, 'approval_1', { type: 'approve' });
  const updatedHistory = await chat.getHistory(session.id);
  assert.ok(updatedHistory.some((entry) => entry.event.type === 'approval.resolved'));

  await iterator.return?.();
});
