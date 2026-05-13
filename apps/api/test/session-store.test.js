import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionStore } from '../src/session-store.js';
import { createFallbackAgentReply } from '../src/agents.js';

function createSocket() {
  return {
    sessionId: null,
    messages: [],
    send(payload) {
      this.messages.push(JSON.parse(payload));
    }
  };
}

function createStore() {
  return new SessionStore({
    config: {
      voiceWsUrl: 'ws://voice/asr',
      voiceTtsUrl: 'http://voice/tts/synthesize',
      voiceTtsStreamUrl: 'http://voice/tts/stream',
      maxTurnBytes: 1024 * 1024,
      codexBinary: 'codex',
      codexCwd: '/repo',
      codexModel: '',
      codexApprovalPolicy: 'never',
      codexSandboxMode: 'workspace-write',
      codexNetworkAccess: true
    },
    random: () => 0,
    createAsrClient: async (_url, onMessage) => ({
      send(message) {
        if (message.type === 'append_audio_chunk') {
          onMessage({
            type: 'partial_transcript',
            turn_id: message.turn_id,
            text: 'partial text',
            provider: 'stub'
          });
        }

        if (message.type === 'end_turn') {
          onMessage({
            type: 'final_transcript',
            turn_id: message.turn_id,
            text: 'final transcript',
            provider: 'stub',
            provider_metadata: { model: 'stub-whisper' }
          });
        }
      },
      close() {
      }
    }),
    synthesizeStream: async (_url, _payload, onEvent) => {
      onEvent({
        type: 'audio_chunk',
        sequence: 0,
        audio: Buffer.from('chunk-1').toString('base64'),
        sample_rate_hz: 24000,
        channels: 1,
        encoding: 'pcm_s16le'
      });
      onEvent({
        type: 'audio_chunk',
        sequence: 1,
        audio: Buffer.from('chunk-2').toString('base64'),
        sample_rate_hz: 24000,
        channels: 1,
        encoding: 'pcm_s16le'
      });
      onEvent({
        type: 'audio_end',
        provider: 'stub',
        duration_ms: 100
      });
    },
    agentReplyFactory: async ({ targetAgentId, transcript }) => createFallbackAgentReply({ targetAgentId, transcript }),
    agentBootstrapFactory: async () => ({
      codex: { configured: true, auth_method: 'chatgpt', requires_openai_auth: false, cwd: '/repo' },
      skills: [{ name: 'voice-mode', path: '/repo/.agents/skills/voice-mode/SKILL.md' }],
      apps: [{ id: 'github', name: 'GitHub', is_accessible: true }],
      warning: null
    })
  });
}

test('session lifecycle emits expected websocket transport messages and streams reply audio', async () => {
  const store = createStore();
  const socket = createSocket();

  await store.handleMessage(socket, { type: 'session.start' });
  await store.handleMessage(socket, {
    type: 'turn.start',
    target_agent_id: 'voice-lead',
    audio_format: { encoding: 'pcm_s16le', sample_rate_hz: 16000, channels: 1 }
  });
  await store.handleMessage(socket, {
    type: 'turn.audio_chunk',
    sequence: 0,
    audio: Buffer.from('abc').toString('base64')
  });
  await store.handleMessage(socket, { type: 'turn.end' });

  assert.equal(socket.messages[0].type, 'session.started');
  assert.equal(socket.messages[0].gateway.id, 'gateway');
  assert.equal(socket.messages[0].agents.length, 4);
  assert.equal(socket.messages[0].skills.length, 1);
  assert.equal(socket.messages[0].apps.length, 1);
  assert.equal(socket.messages[1].type, 'turn.started');
  assert.equal(socket.messages[1].target_agent_id, 'voice-lead');
  assert.equal(socket.messages[2].type, 'turn.partial_transcript');
  assert.equal(socket.messages[3].type, 'turn.final_transcript');
  assert.equal(socket.messages[4].type, 'reply.selected');
  assert.equal(socket.messages[4].agent_id, 'voice-lead');
  assert.match(socket.messages[4].spoken_text, /Voice Lead fallback:/);
  assert.match(socket.messages[4].artifact_text, /Fallback role: Voice Lead/);
  assert.equal(socket.messages[4].provider, 'codex-fallback');
  assert.equal(socket.messages[4].mode, 'fallback');
  assert.equal(socket.messages[4].thread_id, null);
  assert.equal(socket.messages[5].type, 'reply.ready');
  assert.equal(socket.messages[6].type, 'reply.audio_chunk');
  assert.equal(socket.messages[7].type, 'reply.audio_chunk');
  assert.equal(socket.messages[8].type, 'reply.audio_end');
  assert.equal(socket.messages[9].type, 'turn.completed');
  assert.equal(socket.messages[6].sample_rate_hz, 24000);
  assert.equal(socket.messages[8].duration_ms, 100);
});

test('overlapping turns are rejected cleanly', async () => {
  const store = createStore();
  const socket = createSocket();

  await store.handleMessage(socket, { type: 'session.start' });
  await store.handleMessage(socket, { type: 'turn.start' });
  await store.handleMessage(socket, { type: 'turn.start' });

  assert.equal(socket.messages.at(-1).type, 'turn.error');
  assert.equal(socket.messages.at(-1).error, 'Only one active turn is allowed per session.');
});

test('unknown target agent falls back to architect', async () => {
  const store = createStore();
  const socket = createSocket();

  await store.handleMessage(socket, { type: 'session.start' });
  await store.handleMessage(socket, { type: 'turn.start', target_agent_id: 'missing-agent' });
  await store.handleMessage(socket, {
    type: 'turn.audio_chunk',
    sequence: 0,
    audio: Buffer.from('abc').toString('base64')
  });
  await store.handleMessage(socket, { type: 'turn.end' });

  assert.equal(socket.messages[4].agent_id, 'architect');
  assert.match(socket.messages[4].spoken_text, /Architect fallback:/);
});

test('session store passes transcript and selected agent into the reply factory', async () => {
  let captured;
  const store = new SessionStore({
    config: {
      voiceWsUrl: 'ws://voice/asr',
      voiceTtsUrl: 'http://voice/tts/synthesize',
      voiceTtsStreamUrl: 'http://voice/tts/stream',
      maxTurnBytes: 1024 * 1024,
      codexBinary: 'codex',
      codexCwd: '/repo',
      codexModel: 'gpt-5-codex'
    },
    createAsrClient: async (_url, onMessage) => ({
      send(message) {
        if (message.type === 'end_turn') {
          onMessage({
            type: 'final_transcript',
            turn_id: message.turn_id,
            text: 'tell me about session-store',
            provider: 'stub',
            provider_metadata: { model: 'stub-whisper' }
          });
        }
      },
      close() {
      }
    }),
    synthesizeStream: async (_url, _payload, onEvent) => {
      onEvent({ type: 'audio_end', provider: 'stub', duration_ms: 50 });
    },
    agentReplyFactory: async (args) => {
      captured = args;
      return createFallbackAgentReply(args);
    },
    agentBootstrapFactory: async () => ({
      codex: { configured: true, auth_method: 'chatgpt', requires_openai_auth: false, cwd: '/repo' },
      skills: [],
      apps: [],
      warning: null
    })
  });
  const socket = createSocket();

  await store.handleMessage(socket, { type: 'session.start' });
  await store.handleMessage(socket, { type: 'turn.start', target_agent_id: 'orchestrator' });
  await store.handleMessage(socket, { type: 'turn.end' });

  assert.equal(captured.targetAgentId, 'orchestrator');
  assert.equal(captured.transcript, 'tell me about session-store');
  assert.equal(captured.config.codexModel, 'gpt-5-codex');
  assert.ok(captured.sessionState.threadsByAgentId instanceof Map);
});
