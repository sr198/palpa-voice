import test from 'node:test';
import assert from 'node:assert/strict';

import { buildApp } from '../src/app.js';

function createChatServiceStub() {
  return {
    async getBootstrap() {
      return {
        gateway: { id: 'gateway', name: 'Gateway', role: 'Supervisor' },
        agents: [{ id: 'architect', name: 'Architect', role: 'System design', voice_id: 'af_bella', summary: 'Designs systems.' }],
        codex: { configured: true, auth_method: 'chatgpt', cwd: '/repo', warning: null, model: 'gpt-test' },
        skills: [],
        apps: [],
        warning: null
      };
    },
    async listSessions() {
      return [{ id: 'session_1', title: 'Chat', provider: 'codex', status: 'idle', agent: { id: 'architect' }, thread_id: 'thr_1', metadata: { agentId: 'architect' } }];
    },
    async createSession() {
      return { id: 'session_1', title: 'Chat', provider: 'codex', status: 'idle', agent: { id: 'architect' }, thread_id: 'thr_1', metadata: { agentId: 'architect' } };
    },
    async getSession(sessionId) {
      return { id: sessionId, title: 'Chat', provider: 'codex', status: 'idle', agent: { id: 'architect' }, thread_id: 'thr_1', metadata: { agentId: 'architect' } };
    },
    async getHistory() {
      return [{ cursor: '1', event: { type: 'session.created' } }];
    },
    async startRun(sessionId) {
      return { id: 'run_1', session_id: sessionId, status: 'running', agent_id: 'architect', turn_id: 'turn_1' };
    },
    async interruptRun() {
    },
    async respondToApproval() {
    },
    async subscribe() {
      return {
        async *[Symbol.asyncIterator]() {
          yield { cursor: '1', event: { type: 'session.created' } };
        }
      };
    }
  };
}

test('chat backend routes expose bootstrap, session, run, history, and approval contracts', async () => {
  const app = await buildApp({
    config: {
      webOrigin: 'http://127.0.0.1:3000',
      voiceHealthUrl: 'http://voice/health'
    },
    chatService: createChatServiceStub()
  });

  const bootstrap = await app.inject({
    method: 'GET',
    url: '/chat/bootstrap'
  });
  assert.equal(bootstrap.statusCode, 200);
  assert.equal(bootstrap.json().gateway.id, 'gateway');

  const created = await app.inject({
    method: 'POST',
    url: '/chat/sessions',
    payload: {
      title: 'Chat',
      agent_id: 'architect'
    }
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().session.id, 'session_1');

  const listed = await app.inject({
    method: 'GET',
    url: '/chat/sessions'
  });
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.json().sessions.length, 1);

  const session = await app.inject({
    method: 'GET',
    url: '/chat/sessions/session_1'
  });
  assert.equal(session.statusCode, 200);
  assert.equal(session.json().session.id, 'session_1');

  const history = await app.inject({
    method: 'GET',
    url: '/chat/sessions/session_1/history'
  });
  assert.equal(history.statusCode, 200);
  assert.equal(history.json().events[0].event.type, 'session.created');

  const run = await app.inject({
    method: 'POST',
    url: '/chat/sessions/session_1/runs',
    payload: {
      text: 'Inspect the repo'
    }
  });
  assert.equal(run.statusCode, 201);
  assert.equal(run.json().run.id, 'run_1');

  const interrupt = await app.inject({
    method: 'POST',
    url: '/chat/sessions/session_1/runs/run_1/interrupt'
  });
  assert.equal(interrupt.statusCode, 200);
  assert.equal(interrupt.json().ok, true);

  const approval = await app.inject({
    method: 'POST',
    url: '/chat/sessions/session_1/runs/run_1/approvals/approval_1',
    payload: {
      decision: { type: 'approve' }
    }
  });
  assert.equal(approval.statusCode, 200);
  assert.equal(approval.json().ok, true);

  await app.close();
});
