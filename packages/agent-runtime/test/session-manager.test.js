import test from 'node:test';
import assert from 'node:assert/strict';

import { InMemoryRuntimeStore, MockAgentProvider, SessionManager } from '../src/index.js';

async function collect(iterator, count) {
  const entries = [];

  for await (const value of iterator) {
    entries.push(value);
    if (entries.length >= count) {
      break;
    }
  }

  await iterator.return?.();
  return entries;
}

test('sessions can be created, bound, listed, and archived', async () => {
  let sessionCount = 0;
  const manager = new SessionManager({
    provider: new MockAgentProvider(),
    store: new InMemoryRuntimeStore(),
    now: () => 1000,
    createId: (prefix) => {
      if (prefix === 'session') {
        sessionCount += 1;
        return `session_${sessionCount}`;
      }

      return 'run_x';
    }
  });

  await manager.initialize();
  const created = await manager.createSession({ title: 'Fresh session', cwd: '/repo' });
  const bound = await manager.bindSession({ providerSessionId: 'codex-thread-42', title: 'Imported' });

  const sessions = await manager.listSessions();
  assert.equal(sessions.length, 2);
  assert.equal(created.binding.providerSessionId, 'provider_session_1');
  assert.equal(bound.binding.providerSessionId, 'codex-thread-42');

  await manager.archiveSession(created.id);
  const archived = (await manager.listSessions()).find((session) => session.id === created.id);
  assert.equal(archived.status, 'archived');

  await manager.shutdown();
});

test('runs stream unified events and persist replayable history', async () => {
  const provider = new MockAgentProvider({
    scriptFactory({ providerSessionId, providerRunId, runId }) {
      return [
        {
          type: 'message.delta',
          sessionId: providerSessionId,
          runId: providerRunId || runId,
          text: 'Inspecting repo'
        },
        {
          type: 'message.completed',
          sessionId: providerSessionId,
          runId: providerRunId || runId,
          role: 'assistant',
          text: 'Inspecting repo'
        },
        {
          type: 'run.completed',
          sessionId: providerSessionId,
          runId: providerRunId || runId,
          status: 'completed'
        }
      ];
    }
  });

  const manager = new SessionManager({
    provider,
    store: new InMemoryRuntimeStore(),
    now: (() => {
      let tick = 2000;
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

  await manager.initialize();
  const session = await manager.createSession({ title: 'Chat' });
  const subscription = manager.subscribe(session.id);
  const run = await manager.createRun({
    sessionId: session.id,
    input: [{ type: 'text', text: 'Inspect the repo.' }]
  });

  const entries = await collect(subscription, 4);
  assert.deepEqual(entries.slice(0, 2).map((entry) => entry.event.type), ['session.created', 'run.started']);

  const history = await manager.getSessionHistory(session.id);
  assert.ok(history.some((entry) => entry.event.type === 'message.delta'));
  assert.ok(history.some((entry) => entry.event.type === 'message.completed'));
  assert.equal(history.at(-1).event.type, 'run.completed');
  assert.equal(run.status, 'running');

  const replay = await manager.getSessionHistory(session.id, { cursor: history[1].cursor });
  assert.deepEqual(
    replay.map((entry) => entry.event.type),
    ['message.delta', 'message.completed', 'run.completed']
  );

  await manager.shutdown();
});

test('approval requests are persisted and can be resolved from the runtime API', async () => {
  const provider = new MockAgentProvider({
    scriptFactory({ providerSessionId, providerRunId, runId }) {
      return [
        {
          type: 'approval.requested',
          sessionId: providerSessionId,
          runId: providerRunId || runId,
          approval: {
            id: 'approval_1',
            kind: 'command',
            command: ['npm', 'test'],
            cwd: '/repo',
            availableDecisions: ['approve', 'reject']
          }
        }
      ];
    }
  });
  const store = new InMemoryRuntimeStore();
  const manager = new SessionManager({
    provider,
    store,
    now: (() => {
      let tick = 3000;
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

  await manager.initialize();
  const session = await manager.createSession({ title: 'Approvals' });
  await manager.createRun({
    sessionId: session.id,
    input: [{ type: 'text', text: 'Run tests.' }]
  });

  await new Promise((resolve) => setTimeout(resolve, 0));

  const approval = await store.getApproval('approval_1');
  assert.equal(approval.kind, 'command');
  assert.equal(approval.sessionId, session.id);

  await manager.respondToApproval(session.id, approval.runId, approval.id, { type: 'approve' });
  assert.deepEqual(provider.responses, [
    {
      sessionId: session.id,
      runId: approval.runId,
      approvalId: 'approval_1',
      decision: { type: 'approve' }
    }
  ]);

  const history = await manager.getSessionHistory(session.id);
  assert.equal(history.at(-1).event.type, 'approval.resolved');

  await manager.shutdown();
});
