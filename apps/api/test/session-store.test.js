import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionStore } from '../src/session-store.js';

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
      maxTurnBytes: 1024 * 1024
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
    synthesize: async () => ({
      buffer: Buffer.from('RIFF....WAVE', 'utf8'),
      contentType: 'audio/wav',
      voiceId: 'af_bella',
      provider: 'stub',
      durationMs: 100
    })
  });
}

test('session lifecycle emits expected websocket transport messages and stores audio route payload', async () => {
  const store = createStore();
  const socket = createSocket();

  await store.handleMessage(socket, { type: 'session.start' });
  await store.handleMessage(socket, {
    type: 'turn.start',
    audio_format: { encoding: 'pcm_s16le', sample_rate_hz: 16000, channels: 1 }
  });
  await store.handleMessage(socket, {
    type: 'turn.audio_chunk',
    sequence: 0,
    audio: Buffer.from('abc').toString('base64')
  });
  await store.handleMessage(socket, { type: 'turn.end' });

  assert.equal(socket.messages[0].type, 'session.started');
  assert.equal(socket.messages[1].type, 'turn.started');
  assert.equal(socket.messages[2].type, 'turn.partial_transcript');
  assert.equal(socket.messages[3].type, 'turn.final_transcript');
  assert.equal(socket.messages[4].type, 'reply.selected');
  assert.equal(socket.messages[5].type, 'reply.ready');
  assert.equal(socket.messages[6].type, 'turn.completed');
  assert.match(socket.messages[5].audio_url, /^\/audio\//);

  const audioRecord = store.getAudio(socket.messages[0].session_id, socket.messages[1].turn_id);
  assert.equal(audioRecord.contentType, 'audio/wav');
  assert.equal(audioRecord.buffer.toString('utf8'), 'RIFF....WAVE');
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
