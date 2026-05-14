import { createEvent } from './events.js';
import { discoverCodexWorkspace, generateAgentReply, gatewayAgent, listAgentIds, listAgents } from './agents.js';
import { createVoiceAsrClient, synthesizeVoiceStream } from './voice-client.js';

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

function buildFloorState({ activeAgentId = null } = {}) {
  return {
    supervisor_id: gatewayAgent.id,
    supervisor_name: gatewayAgent.name,
    active_agent_id: activeAgentId,
    available_agent_ids: listAgentIds(),
    next_agent_ids: listAgentIds()
  };
}

function createEmptyAgentExecution(targetAgentId) {
  return {
    targetAgentId,
    stage: 'idle',
    threadId: null,
    turnId: null,
    activities: []
  };
}

export class SessionStore {
  constructor({ config, random = Math.random, createAsrClient = createVoiceAsrClient, synthesizeStream = synthesizeVoiceStream, agentReplyFactory = generateAgentReply, agentBootstrapFactory = discoverCodexWorkspace }) {
    this.config = config;
    this.random = random;
    this.createAsrClient = createAsrClient;
    this.synthesizeStream = synthesizeStream;
    this.agentReplyFactory = agentReplyFactory;
    this.agentBootstrapFactory = agentBootstrapFactory;
    this.sessions = new Map();
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
      events: [],
      agentState: {
        threadsByAgentId: new Map(),
        skillsByName: new Map(),
        appsById: new Map()
      }
    };

    socket.sessionId = session.id;
    this.sessions.set(session.id, session);
    return session;
  }

  async handleMessage(socket, message) {
    const session = this.getOrCreateSession(socket);

    if (message.type === 'session.start') {
      const bootstrap = await this.agentBootstrapFactory({
        config: this.config
      });

      for (const skill of bootstrap.skills || []) {
        session.agentState.skillsByName.set(skill.name, skill);
      }

      for (const app of bootstrap.apps || []) {
        session.agentState.appsById.set(app.id, app);
      }

      send(socket, 'session.started', {
        session_id: session.id,
        timestamp: new Date().toISOString(),
        gateway: {
          id: gatewayAgent.id,
          name: gatewayAgent.name,
          role: gatewayAgent.role,
          voice_id: gatewayAgent.voiceId,
          summary: gatewayAgent.summary
        },
        agents: listAgents(),
        floor: buildFloorState(),
        codex: bootstrap.codex,
        skills: bootstrap.skills,
        apps: bootstrap.apps,
        warning: bootstrap.warning
      });
      return;
    }

    if (message.type === 'turn.start') {
      await this.startTurn(session, message.audio_format, message.target_agent_id);
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

  async startTurn(session, audioFormat, targetAgentId) {
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
      partialTranscript: '',
      targetAgentId: targetAgentId || 'architect',
      agentExecution: createEmptyAgentExecution(targetAgentId || 'architect')
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
      target_agent_id: turn.targetAgentId,
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
    this.publishAgentStage(session, turn, {
      stage: 'routing',
      target_agent_id: turn.targetAgentId
    });

    const selection = await this.agentReplyFactory({
      sessionState: session.agentState,
      targetAgentId: turn.targetAgentId,
      transcript: turn.finalTranscript,
      config: this.config,
      onEvent: (event) => this.handleAgentRuntimeEvent(session, turn, event)
    });
    session.events.push(
      createEvent('voice.reply.selected', session.id, turn.id, {
        gateway_id: selection.gateway.id,
        gateway_name: selection.gateway.name,
        agent_id: selection.agent.id,
        agent_name: selection.agent.name,
        agent_role: selection.agent.role,
        voice_id: selection.agent.voiceId,
        spoken_text: selection.spokenText,
        should_speak: selection.shouldSpeak,
        delivery_mode: selection.deliveryMode,
        artifact_text: selection.artifactText,
        artifact: {
          text: selection.artifact.text,
          render_mode: selection.artifact.renderMode,
          files_touched: selection.artifact.filesTouched,
          commands_run: selection.artifact.commandsRun,
          tool_activity: selection.artifact.toolActivity,
          diff_summary: selection.artifact.diffSummary
        },
        topics: selection.topics,
        next_agent_suggestions: selection.nextAgentSuggestions,
        provider: selection.provider,
        mode: selection.mode,
        warning: selection.warning,
        thread_id: selection.threadId,
        skills_used: selection.skillsUsed,
        floor: buildFloorState({ activeAgentId: selection.agent.id })
      })
    );

    send(session.socket, 'reply.selected', {
      session_id: session.id,
      turn_id: turn.id,
      gateway_id: selection.gateway.id,
      gateway_name: selection.gateway.name,
      agent_id: selection.agent.id,
      agent_name: selection.agent.name,
      agent_role: selection.agent.role,
      voice_id: selection.agent.voiceId,
      spoken_text: selection.spokenText,
      should_speak: selection.shouldSpeak,
      delivery_mode: selection.deliveryMode,
      artifact_text: selection.artifactText,
      artifact: {
        text: selection.artifact.text,
        render_mode: selection.artifact.renderMode,
        files_touched: selection.artifact.filesTouched,
        commands_run: selection.artifact.commandsRun,
        tool_activity: selection.artifact.toolActivity,
        diff_summary: selection.artifact.diffSummary
      },
      text: selection.spokenText,
      topics: selection.topics,
      next_agent_suggestions: selection.nextAgentSuggestions,
      provider: selection.provider,
      mode: selection.mode,
      warning: selection.warning,
      thread_id: selection.threadId,
      skills_used: selection.skillsUsed,
      floor: buildFloorState({ activeAgentId: selection.agent.id })
    });

    try {
      let durationMs = 0;
      let provider = 'unknown';
      if (selection.shouldSpeak && selection.spokenText) {
        turn.state = 'synthesizing';
        send(session.socket, 'reply.ready', {
          session_id: session.id,
          turn_id: turn.id,
          should_speak: true,
          stream: {
            encoding: 'pcm_s16le',
            channels: 1
          }
        });

        await this.synthesizeStream(this.config.voiceTtsStreamUrl, {
          text: selection.spokenText,
          voice_id: selection.agent.voiceId,
          output_format: 'wav'
        }, (event) => {
          if (event.type === 'audio_chunk') {
            send(session.socket, 'reply.audio_chunk', {
              session_id: session.id,
              turn_id: turn.id,
              sequence: event.sequence,
              audio: event.audio,
              sample_rate_hz: event.sample_rate_hz,
              channels: event.channels,
              encoding: event.encoding
            });
            return;
          }

          if (event.type === 'audio_end') {
            durationMs = event.duration_ms || 0;
            provider = event.provider || provider;
            send(session.socket, 'reply.audio_end', {
              session_id: session.id,
              turn_id: turn.id,
              duration_ms: durationMs,
              provider
            });
          }
        });

        session.events.push(
          createEvent('voice.reply.synthesized', session.id, turn.id, {
            gateway_id: selection.gateway.id,
            agent_id: selection.agent.id,
            voice_id: selection.agent.voiceId,
            provider,
            duration_ms: durationMs,
            reply_provider: selection.provider,
            reply_mode: selection.mode
          })
        );
      } else {
        turn.state = 'completed';
        send(session.socket, 'reply.ready', {
          session_id: session.id,
          turn_id: turn.id,
          should_speak: false
        });
      }

      turn.state = 'completed';
      this.publishAgentStage(session, turn, {
        stage: 'reply_ready',
        target_agent_id: selection.agent.id,
        thread_id: selection.threadId
      });
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
    this.publishAgentStage(session, turn, {
      stage: 'failed',
      target_agent_id: turn.targetAgentId,
      error
    });
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

  handleAgentRuntimeEvent(session, turn, event) {
    if (!event || !session.currentTurn || session.currentTurn.id !== turn.id) {
      return;
    }

    if (event.type === 'stage') {
      this.publishAgentStage(session, turn, {
        stage: event.stage,
        target_agent_id: turn.targetAgentId,
        thread_id: event.threadId || turn.agentExecution.threadId || null,
        codex_turn_id: event.turnId || turn.agentExecution.turnId || null,
        status: event.status || null,
        error: event.error || null
      });
      return;
    }

    if (event.type === 'activity') {
      if (event.stage) {
        this.publishAgentStage(session, turn, {
          stage: event.stage,
          target_agent_id: turn.targetAgentId,
          thread_id: event.threadId || turn.agentExecution.threadId || null,
          codex_turn_id: event.turnId || turn.agentExecution.turnId || null
        });
      }

      this.publishAgentActivity(session, turn, {
        target_agent_id: turn.targetAgentId,
        thread_id: event.threadId || turn.agentExecution.threadId || null,
        codex_turn_id: event.turnId || turn.agentExecution.turnId || null,
        ...event.activity
      });
    }
  }

  publishAgentStage(session, turn, payload) {
    turn.agentExecution.stage = payload.stage;
    if (payload.thread_id) {
      turn.agentExecution.threadId = payload.thread_id;
    }
    if (payload.codex_turn_id) {
      turn.agentExecution.turnId = payload.codex_turn_id;
    }

    session.events.push(
      createEvent('agent.stage.changed', session.id, turn.id, payload)
    );
    send(session.socket, 'agent.stage', {
      session_id: session.id,
      turn_id: turn.id,
      timestamp: new Date().toISOString(),
      ...payload
    });
  }

  publishAgentActivity(session, turn, payload) {
    turn.agentExecution.activities.push(payload);
    if (turn.agentExecution.activities.length > 25) {
      turn.agentExecution.activities = turn.agentExecution.activities.slice(-25);
    }

    session.events.push(
      createEvent('agent.activity', session.id, turn.id, payload)
    );
    send(session.socket, 'agent.activity', {
      session_id: session.id,
      turn_id: turn.id,
      timestamp: new Date().toISOString(),
      ...payload
    });
  }
}
