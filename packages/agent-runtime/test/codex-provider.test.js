import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';

import { CodexProvider } from '../src/index.js';

class FakeChildProcess extends EventEmitter {
  constructor(onClientMessage) {
    super();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.stdin = new Writable({
      write: (chunk, _encoding, callback) => {
        this.buffer += chunk.toString();
        let newlineIndex = this.buffer.indexOf('\n');
        while (newlineIndex >= 0) {
          const line = this.buffer.slice(0, newlineIndex).trim();
          this.buffer = this.buffer.slice(newlineIndex + 1);
          if (line) {
            onClientMessage(JSON.parse(line), this);
          }
          newlineIndex = this.buffer.indexOf('\n');
        }
        callback();
      }
    });
    this.stdin.writable = true;
    this.buffer = '';
  }

  send(message) {
    this.stdout.write(`${JSON.stringify(message)}\n`);
  }

  kill() {
    this.emit('exit', 0, null);
  }
}

function createSpawnProcess(handler) {
  return () => new FakeChildProcess(handler);
}

async function readNext(iterable) {
  const iterator = iterable[Symbol.asyncIterator]();
  const result = await iterator.next();
  await iterator.return?.();
  return result.value;
}

test('CodexProvider initializes, starts sessions and runs, and maps streamed events', async () => {
  const seenClientMessages = [];
  const spawnProcess = createSpawnProcess((message, child) => {
    seenClientMessages.push(message);

    if (message.method === 'initialize') {
      child.send({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          userAgent: 'fake-codex',
          codexHome: '/tmp/codex',
          platformFamily: 'unix',
          platformOs: 'linux'
        }
      });
      return;
    }

    if (message.method === 'thread/start') {
      child.send({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          thread: {
            id: 'thr_1',
            name: 'Test thread',
            status: 'idle',
            cwd: '/repo'
          }
        }
      });
      return;
    }

    if (message.method === 'turn/start') {
      child.send({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          turn: {
            id: 'turn_1',
            status: 'inProgress'
          }
        }
      });

      queueMicrotask(() => {
        child.send({
          jsonrpc: '2.0',
          method: 'item/agentMessage/delta',
          params: {
            threadId: 'thr_1',
            turnId: 'turn_1',
            itemId: 'msg_1',
            delta: 'Hello'
          }
        });
        child.send({
          jsonrpc: '2.0',
          method: 'item/completed',
          params: {
            threadId: 'thr_1',
            turnId: 'turn_1',
            item: {
              id: 'msg_1',
              type: 'agentMessage',
              text: 'Hello'
            }
          }
        });
        child.send({
          jsonrpc: '2.0',
          method: 'turn/completed',
          params: {
            threadId: 'thr_1',
            turn: {
              id: 'turn_1',
              status: 'completed'
            }
          }
        });
      });
    }
  });

  const provider = new CodexProvider({
    config: {
      codexBinary: 'codex',
      codexCwd: '/repo',
      clientName: 'palpa-test',
      clientTitle: 'Palpa Test'
    },
    spawnProcess
  });

  await provider.initialize();
  const session = await provider.createSession({ title: 'Chat', cwd: '/repo' });
  assert.equal(session.providerSessionId, 'thr_1');

  const stream = provider.stream();
  const eventPromise = readNext(stream);
  const run = await provider.createRun({
    sessionId: 'session_1',
    runId: 'run_1',
    providerSessionId: 'thr_1',
    input: [{ type: 'text', text: 'Hello' }]
  });

  assert.equal(run.providerRunId, 'turn_1');
  const event = await eventPromise;
  assert.equal(event.type, 'message.delta');
  assert.equal(event.sessionId, 'thr_1');
  assert.equal(event.runId, 'turn_1');

  assert.equal(seenClientMessages[0].method, 'initialize');
  assert.equal(seenClientMessages[1].method, 'initialized');
  assert.equal(seenClientMessages[2].method, 'thread/start');
  assert.equal(seenClientMessages[3].method, 'turn/start');

  await provider.shutdown();
});

test('CodexProvider surfaces approval requests and sends approval responses', async () => {
  const seenClientMessages = [];
  const spawnProcess = createSpawnProcess((message, child) => {
    seenClientMessages.push(message);

    if (message.method === 'initialize') {
      child.send({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          userAgent: 'fake-codex',
          codexHome: '/tmp/codex',
          platformFamily: 'unix',
          platformOs: 'linux'
        }
      });
      return;
    }

    if (message.method === 'thread/read') {
      child.send({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          thread: {
            id: 'thr_approval',
            name: 'Existing thread',
            status: 'idle',
            cwd: '/repo'
          }
        }
      });

      queueMicrotask(() => {
        child.send({
          jsonrpc: '2.0',
          id: 99,
          method: 'item/commandExecution/requestApproval',
          params: {
            threadId: 'thr_approval',
            turnId: 'turn_approval',
            itemId: 'cmd_1',
            command: ['npm', 'test'],
            cwd: '/repo',
            reason: 'Need to run tests',
            availableDecisions: ['accept', 'decline', 'cancel']
          }
        });
      });
    }
  });

  const provider = new CodexProvider({
    config: {
      codexBinary: 'codex',
      codexCwd: '/repo'
    },
    spawnProcess
  });

  await provider.initialize();
  const stream = provider.stream();
  await provider.bindSession({ providerSessionId: 'thr_approval' });
  const approvalEvent = await readNext(stream);

  assert.equal(approvalEvent.type, 'approval.requested');
  assert.equal(approvalEvent.approval.kind, 'command');
  assert.deepEqual(approvalEvent.approval.command, ['npm', 'test']);
  assert.deepEqual(approvalEvent.approval.availableDecisions, ['approve', 'reject', 'cancel']);

  await provider.respondToApproval({
    approvalId: approvalEvent.approval.id,
    decision: { type: 'approve' }
  });

  const approvalResponse = seenClientMessages.at(-1);
  assert.equal(approvalResponse.id, 99);
  assert.deepEqual(approvalResponse.result, { decision: 'accept' });

  await provider.shutdown();
});
