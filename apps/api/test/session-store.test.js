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
  assert.equal(socket.messages[0].floor.supervisor_id, 'gateway');
  assert.equal(socket.messages[0].skills.length, 1);
  assert.equal(socket.messages[0].apps.length, 1);
  assert.equal(socket.messages[1].type, 'turn.started');
  assert.equal(socket.messages[1].target_agent_id, 'voice-lead');
  assert.equal(socket.messages[2].type, 'turn.partial_transcript');
  assert.equal(socket.messages[3].type, 'turn.final_transcript');
  assert.equal(socket.messages[4].type, 'agent.stage');
  assert.equal(socket.messages[4].stage, 'routing');
  assert.equal(socket.messages[5].type, 'reply.selected');
  assert.equal(socket.messages[5].agent_id, 'voice-lead');
  assert.match(socket.messages[5].spoken_text, /Voice Lead fallback:/);
  assert.match(socket.messages[5].artifact_text, /Fallback role: Voice Lead/);
  assert.equal(socket.messages[5].should_speak, true);
  assert.equal(socket.messages[5].delivery_mode, 'voice_and_visual');
  assert.deepEqual(socket.messages[5].artifact.files_touched, []);
  assert.equal(socket.messages[5].floor.active_agent_id, 'voice-lead');
  assert.equal(socket.messages[5].provider, 'codex-fallback');
  assert.equal(socket.messages[5].mode, 'fallback');
  assert.equal(socket.messages[5].thread_id, null);
  assert.equal(socket.messages[6].type, 'reply.ready');
  assert.equal(socket.messages[7].type, 'reply.audio_chunk');
  assert.equal(socket.messages[8].type, 'reply.audio_chunk');
  assert.equal(socket.messages[9].type, 'reply.audio_end');
  assert.equal(socket.messages[10].type, 'agent.stage');
  assert.equal(socket.messages[10].stage, 'reply_ready');
  assert.equal(socket.messages[11].type, 'turn.completed');
  assert.equal(socket.messages[7].sample_rate_hz, 24000);
  assert.equal(socket.messages[9].duration_ms, 100);
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

  const replySelected = socket.messages.find((message) => message.type === 'reply.selected');
  assert.equal(replySelected.agent_id, 'architect');
  assert.match(replySelected.spoken_text, /Architect fallback:/);
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

test('agent runtime events are forwarded over websocket', async () => {
  const store = new SessionStore({
    config: {
      voiceWsUrl: 'ws://voice/asr',
      voiceTtsStreamUrl: 'http://voice/tts/stream',
      maxTurnBytes: 1024 * 1024
    },
    random: () => 0,
    createAsrClient: async (_url, onMessage) => ({
      send(message) {
        if (message.type === 'end_turn') {
          onMessage({
            type: 'final_transcript',
            turn_id: message.turn_id,
            text: 'inspect the current state',
            provider: 'stub'
          });
        }
      },
      close() {
      }
    }),
    synthesizeStream: async (_url, _payload, onEvent) => {
      onEvent({ type: 'audio_end', provider: 'stub', duration_ms: 10 });
    },
    agentReplyFactory: async ({ targetAgentId, onEvent }) => {
      onEvent({ type: 'stage', stage: 'thinking', threadId: 'thread_live', turnId: 'codex_turn_1' });
      onEvent({
        type: 'activity',
        stage: 'tool_running',
        threadId: 'thread_live',
        turnId: 'codex_turn_1',
        activity: {
          kind: 'command_output',
          command: 'npm test',
          output: '1 passing'
        }
      });

      return createFallbackAgentReply({ targetAgentId, transcript: 'inspect the current state' });
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
  await store.handleMessage(socket, { type: 'turn.start', target_agent_id: 'architect' });
  await store.handleMessage(socket, { type: 'turn.end' });

  const stageEvents = socket.messages.filter((message) => message.type === 'agent.stage');
  const activityEvents = socket.messages.filter((message) => message.type === 'agent.activity');

  assert.ok(stageEvents.some((message) => message.stage === 'thinking' && message.thread_id === 'thread_live'));
  assert.ok(stageEvents.some((message) => message.stage === 'tool_running'));
  assert.ok(activityEvents.some((message) => message.kind === 'command_output' && message.command === 'npm test'));
});

test('visual-only replies are rendered without TTS streaming', async () => {
  const store = new SessionStore({
    config: {
      voiceWsUrl: 'ws://voice/asr',
      voiceTtsStreamUrl: 'http://voice/tts/stream',
      maxTurnBytes: 1024 * 1024
    },
    random: () => 0,
    createAsrClient: async (_url, onMessage) => ({
      send(message) {
        if (message.type === 'end_turn') {
          onMessage({
            type: 'final_transcript',
            turn_id: message.turn_id,
            text: 'render this silently',
            provider: 'stub'
          });
        }
      },
      close() {
      }
    }),
    synthesizeStream: async () => {
      throw new Error('synthesizeStream should not be called for visual-only replies');
    },
    agentReplyFactory: async ({ targetAgentId }) => {
      const fallback = createFallbackAgentReply({ targetAgentId, transcript: 'render this silently' });
      return {
        ...fallback,
        spokenText: '',
        shouldSpeak: false,
        deliveryMode: 'visual',
        artifact: {
          ...fallback.artifact,
          text: 'Visual artifact only'
        },
        artifactText: 'Visual artifact only'
      };
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
  await store.handleMessage(socket, { type: 'turn.start', target_agent_id: 'frontend' });
  await store.handleMessage(socket, { type: 'turn.end' });

  const replySelected = socket.messages.find((message) => message.type === 'reply.selected');
  const replyReady = socket.messages.find((message) => message.type === 'reply.ready');

  assert.equal(replySelected.delivery_mode, 'visual');
  assert.equal(replySelected.should_speak, false);
  assert.equal(replySelected.artifact.text, 'Visual artifact only');
  assert.equal(replyReady.should_speak, false);
  assert.equal(socket.messages.some((message) => message.type === 'reply.audio_chunk'), false);
  assert.equal(socket.messages.at(-1).type, 'turn.completed');
});
