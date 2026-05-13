import { createEvent } from './events.js';
import { selectMockReply } from './roles.js';
import { createVoiceAsrClient, synthesizeVoice } from './voice-client.js';

function sessionMessage(type, payload) {
  return JSON.stringify({ type, ...payload });
}

function send(socket, type, payload) {
  socket.send(sessionMessage(type, payload));
}

function buildSessionId(random = Math.random) {
  return `sess_${Math.floor(random() * 1e9).toString(36)}`;
}

function buildTurnId(random = Math.random) {
  return `turn_${Math.floor(random() * 1e9).toString(36)}`;
}

export class SessionStore {
  constructor({ config, random = Math.random, createAsrClient = createVoiceAsrClient, synthesize = synthesizeVoice }) {
    this.config = config;
    this.random = random;
    this.createAsrClient = createAsrClient;
    this.synthesize = synthesize;
    this.sessions = new Map();
    this.audio = new Map();
  }

  getOrCreateSession(socket) {
    const existing = socket.sessionId && this.sessions.get(socket.sessionId);
    if (existing) {
      existing.socket = socket;
      return existing;
    }

    const session = {
      id: buildSessionId(this.random),
      socket,
      currentTurn: null,
      events: []
    };

    socket.sessionId = session.id;
    this.sessions.set(session.id, session);
    return session;
  }

  async handleMessage(socket, message) {
    const session = this.getOrCreateSession(socket);

    if (message.type === 'session.start') {
      send(socket, 'session.started', {
        session_id: session.id,
        timestamp: new Date().toISOString()
      });
      return;
    }

    if (message.type === 'turn.start') {
      await this.startTurn(session, message.audio_format);
      return;
    }

    if (message.type === 'turn.audio_chunk') {
      await this.appendAudioChunk(session, message);
      return;
    }

    if (message.type === 'turn.end') {
      await this.endTurn(session);
    }
  }

  async startTurn(session, audioFormat) {
    if (session.currentTurn && session.currentTurn.state !== 'completed' && session.currentTurn.state !== 'error') {
      send(session.socket, 'turn.error', { error: 'Only one active turn is allowed per session.' });
      return;
    }

    const turn = {
      id: buildTurnId(this.random),
      state: 'recording',
      audioFormat: audioFormat || { encoding: 'pcm_s16le', sample_rate_hz: 16000, channels: 1 },
      bytesReceived: 0,
      startedAt: Date.now(),
      finalTranscript: '',
      partialTranscript: ''
    };

    session.currentTurn = turn;
    try {
      turn.asrClient = await this.createAsrClient(
        this.config.voiceWsUrl,
        (event) => this.handleVoiceEvent(session, event),
        () => {
          if (session.currentTurn && session.currentTurn.id === turn.id && turn.state !== 'completed') {
            this.failTurn(session, 'Voice transcription transport disconnected.');
          }
        }
      );
    } catch (error) {
      session.currentTurn = null;
      send(session.socket, 'turn.error', {
        error: error instanceof Error ? error.message : 'API cannot reach voice service.'
      });
      return;
    }

    turn.asrClient.send({
      type: 'start_turn',
      session_id: session.id,
      turn_id: turn.id,
      audio_format: turn.audioFormat
    });

    session.events.push(createEvent('voice.turn.started', session.id, turn.id, { state: turn.state }));
    send(session.socket, 'turn.started', {
      session_id: session.id,
      turn_id: turn.id,
      state: turn.state,
      timestamp: new Date().toISOString()
    });
  }

  async appendAudioChunk(session, message) {
    const turn = session.currentTurn;
    if (!turn || turn.state !== 'recording') {
      send(session.socket, 'turn.error', { error: 'No active turn to receive audio.' });
      return;
    }

    const chunk = Buffer.from(message.audio || '', 'base64');
    turn.bytesReceived += chunk.length;

    if (turn.bytesReceived > this.config.maxTurnBytes) {
      this.failTurn(session, 'Turn exceeded the in-memory audio buffer limit.');
      return;
    }

    turn.asrClient.send({
      type: 'append_audio_chunk',
      session_id: session.id,
      turn_id: turn.id,
      sequence: message.sequence,
      audio: message.audio
    });
  }

  async endTurn(session) {
    const turn = session.currentTurn;
    if (!turn || turn.state !== 'recording') {
      send(session.socket, 'turn.error', { error: 'No active recording turn to end.' });
      return;
    }

    turn.state = 'transcribing';
    turn.asrClient.send({
      type: 'end_turn',
      session_id: session.id,
      turn_id: turn.id
    });
  }

  async handleVoiceEvent(session, event) {
    const turn = session.currentTurn;
    if (!turn || event.turn_id !== turn.id) {
      return;
    }

    if (event.type === 'partial_transcript') {
      turn.partialTranscript = event.text;
      session.events.push(createEvent('voice.turn.partial_transcript', session.id, turn.id, { text: event.text, provider: event.provider }));
      send(session.socket, 'turn.partial_transcript', {
        session_id: session.id,
        turn_id: turn.id,
        text: event.text,
        timestamp: new Date().toISOString()
      });
      return;
    }

    if (event.type === 'turn_error') {
      this.failTurn(session, event.error || 'Transcription failed.');
      return;
    }

    if (event.type === 'final_transcript') {
      turn.state = 'finalized';
      turn.finalTranscript = (event.text || '').trim();
      session.events.push(
        createEvent('voice.turn.final_transcript', session.id, turn.id, {
          text: turn.finalTranscript,
          provider: event.provider,
          provider_metadata: event.provider_metadata
        })
      );

      if (!turn.finalTranscript) {
        this.failTurn(session, 'Turn was too short to produce a usable transcript.');
        return;
      }

      send(session.socket, 'turn.final_transcript', {
        session_id: session.id,
        turn_id: turn.id,
        text: turn.finalTranscript,
        timestamp: new Date().toISOString()
      });

      await this.generateReply(session, turn);
    }
  }

  async generateReply(session, turn) {
    turn.state = 'reply_generating';
    const selection = selectMockReply(this.random);
    session.events.push(
      createEvent('voice.reply.selected', session.id, turn.id, {
        role_id: selection.role.id,
        role_name: selection.role.name,
        voice_id: selection.role.voiceId,
        text: selection.reply
      })
    );

    send(session.socket, 'reply.selected', {
      session_id: session.id,
      turn_id: turn.id,
      role_id: selection.role.id,
      role_name: selection.role.name,
      voice_id: selection.role.voiceId,
      text: selection.reply
    });

    turn.state = 'synthesizing';

    try {
      const synthesis = await this.synthesize(this.config.voiceTtsUrl, {
        text: selection.reply,
        voice_id: selection.role.voiceId,
        output_format: 'wav'
      });

      const audioKey = `${session.id}:${turn.id}`;
      this.audio.set(audioKey, {
        buffer: synthesis.buffer,
        contentType: synthesis.contentType,
        expiresAt: Date.now() + 1000 * 60 * 10
      });

      session.events.push(
        createEvent('voice.reply.synthesized', session.id, turn.id, {
          voice_id: synthesis.voiceId,
          provider: synthesis.provider,
          duration_ms: synthesis.durationMs
        })
      );

      send(session.socket, 'reply.ready', {
        session_id: session.id,
        turn_id: turn.id,
        audio_url: `/audio/${session.id}/${turn.id}`
      });

      turn.state = 'completed';
      const elapsedMs = Date.now() - turn.startedAt;
      session.events.push(createEvent('voice.turn.completed', session.id, turn.id, { elapsed_ms: elapsedMs }));
      send(session.socket, 'turn.completed', {
        session_id: session.id,
        turn_id: turn.id,
        elapsed_ms: elapsedMs
      });
      turn.asrClient.close();
      session.currentTurn = null;
    } catch (error) {
      this.failTurn(session, error instanceof Error ? error.message : 'Voice synthesis failed.');
    }
  }

  failTurn(session, error) {
    const turn = session.currentTurn;
    if (!turn) {
      return;
    }

    turn.state = 'error';
    session.events.push(createEvent('voice.turn.failed', session.id, turn.id, { error }));
    send(session.socket, 'turn.error', {
      session_id: session.id,
      turn_id: turn.id,
      error
    });

    if (turn.asrClient) {
      try {
        turn.asrClient.send({
          type: 'cancel_turn',
          session_id: session.id,
          turn_id: turn.id
        });
        turn.asrClient.close();
      } catch {
      }
    }

    session.currentTurn = null;
  }

  getAudio(sessionId, turnId) {
    const record = this.audio.get(`${sessionId}:${turnId}`);
    if (!record || record.expiresAt < Date.now()) {
      this.audio.delete(`${sessionId}:${turnId}`);
      return null;
    }
    return record;
  }
}
