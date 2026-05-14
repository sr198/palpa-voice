'use client';

import { useEffect, useRef, useState } from 'react';

const apiOrigin = process.env.NEXT_PUBLIC_API_ORIGIN || 'http://127.0.0.1:3001';
const wsOrigin = apiOrigin.replace(/^http/, 'ws');

const idleStatus = 'Connecting to session transport...';

function encodePcm16(samples) {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);

  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }

  return buffer;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return window.btoa(binary);
}

function downsampleTo16k(channelData, sourceRate) {
  if (sourceRate === 16000) {
    return channelData;
  }

  const ratio = sourceRate / 16000;
  const outputLength = Math.round(channelData.length / ratio);
  const result = new Float32Array(outputLength);
  let outputIndex = 0;
  let inputIndex = 0;

  while (outputIndex < outputLength) {
    const nextIndex = Math.round((outputIndex + 1) * ratio);
    let sum = 0;
    let count = 0;

    for (let index = inputIndex; index < nextIndex && index < channelData.length; index += 1) {
      sum += channelData[index];
      count += 1;
    }

    result[outputIndex] = count ? sum / count : 0;
    outputIndex += 1;
    inputIndex = nextIndex;
  }

  return result;
}

function base64ToInt16(base64) {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Int16Array(bytes.buffer);
}

function formatActivityPayload(item) {
  const payload = {
    kind: item.kind || null,
    command: item.command || null,
    tool_name: item.tool_name || null,
    path: item.path || null,
    status: item.status || null,
    text: item.text || null,
    output: item.output || null,
    detail: item.detail || null,
    thread_id: item.thread_id || null,
    codex_turn_id: item.codex_turn_id || null
  };

  return JSON.stringify(
    Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== null && value !== '')),
    null,
    2
  );
}

export default function Home() {
  const [connectionState, setConnectionState] = useState('connecting');
  const [session, setSession] = useState(null);
  const [agents, setAgents] = useState([]);
  const [floor, setFloor] = useState(null);
  const [selectedAgentId, setSelectedAgentId] = useState('architect');
  const [turn, setTurn] = useState(null);
  const [partialTranscript, setPartialTranscript] = useState('');
  const [finalTranscript, setFinalTranscript] = useState('');
  const [reply, setReply] = useState(null);
  const [agentStage, setAgentStage] = useState(null);
  const [agentActivity, setAgentActivity] = useState([]);
  const [error, setError] = useState('');
  const [status, setStatus] = useState(idleStatus);
  const [isRecording, setIsRecording] = useState(false);
  const [micReady, setMicReady] = useState(false);

  const wsRef = useRef(null);
  const streamRef = useRef(null);
  const audioContextRef = useRef(null);
  const processorRef = useRef(null);
  const sourceRef = useRef(null);
  const sampleBufferRef = useRef([]);
  const sequenceRef = useRef(0);
  const turnIdRef = useRef(null);
  const recordingRef = useRef(false);
  const playbackContextRef = useRef(null);
  const playbackCursorRef = useRef(0);

  useEffect(() => {
    const ws = new WebSocket(`${wsOrigin}/ws`);
    wsRef.current = ws;

    ws.addEventListener('open', () => {
      setConnectionState('connected');
      setStatus('Connected. Bootstrapping session...');
      ws.send(JSON.stringify({ type: 'session.start' }));
    });

    ws.addEventListener('close', () => {
      setConnectionState('disconnected');
      setStatus('Disconnected from API transport.');
    });

    ws.addEventListener('error', () => {
      setConnectionState('error');
      setError('Browser WebSocket disconnected.');
    });

    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);

      if (message.type === 'session.started') {
        setSession(message);
        setAgents(message.agents || []);
        setFloor(message.floor || null);
        if (message.agents?.length) {
          setSelectedAgentId((current) => (
            message.agents.some((agent) => agent.id === current) ? current : message.agents[0].id
          ));
        }
        setStatus(`Session ${message.session_id} ready.`);
      }

      if (message.type === 'turn.started') {
        turnIdRef.current = message.turn_id;
        setTurn(message);
        setAgentStage(null);
        setAgentActivity([]);
        setStatus(`Turn ${message.turn_id} recording for ${message.target_agent_id}.`);
      }

      if (message.type === 'turn.partial_transcript') {
        setPartialTranscript(message.text);
        setStatus('Receiving partial transcript...');
      }

      if (message.type === 'turn.final_transcript') {
        setFinalTranscript(message.text);
        setPartialTranscript('');
        setStatus('Final transcript received.');
      }

      if (message.type === 'reply.selected') {
        setReply((current) => ({
          ...(current || {}),
          gateway_id: message.gateway_id,
          gateway_name: message.gateway_name,
          agent_id: message.agent_id,
          agent_name: message.agent_name,
          agent_role: message.agent_role,
          voice_id: message.voice_id,
          spoken_text: message.spoken_text,
          artifact_text: message.artifact_text,
          text: message.text,
          topics: message.topics || [],
          provider: message.provider,
          mode: message.mode,
          warning: message.warning,
          thread_id: message.thread_id,
          skills_used: message.skills_used || [],
          should_speak: message.should_speak,
          delivery_mode: message.delivery_mode,
          artifact: message.artifact || null,
          next_agent_suggestions: message.next_agent_suggestions || [],
          floor: message.floor || null
        }));
        setFloor(message.floor || null);
        setStatus(`Reply selected: ${message.agent_name}.`);
      }

      if (message.type === 'agent.stage') {
        setAgentStage(message);
        setStatus(`Agent stage: ${message.stage}.`);
      }

      if (message.type === 'agent.activity') {
        setAgentActivity((current) => [message, ...current].slice(0, 12));
      }

      if (message.type === 'reply.ready') {
        playbackCursorRef.current = 0;
        setStatus(message.should_speak ? 'Synthesized audio stream starting.' : 'Rendered reply ready.');
      }

      if (message.type === 'reply.audio_chunk') {
        void queuePlaybackChunk(message);
        setStatus('Streaming reply audio...');
      }

      if (message.type === 'reply.audio_end') {
        setStatus(`Reply audio complete from ${message.provider}.`);
      }

      if (message.type === 'turn.completed') {
        setStatus(`Turn completed in ${message.elapsed_ms}ms.`);
        setTurn(null);
        turnIdRef.current = null;
        recordingRef.current = false;
      }

      if (message.type === 'turn.error') {
        setError(message.error);
        setStatus('Turn failed.');
        setTurn(null);
        turnIdRef.current = null;
        recordingRef.current = false;
        setIsRecording(false);
      }
    });

    return () => {
      recordingRef.current = false;
      ws.close();
      if (processorRef.current) {
        processorRef.current.disconnect();
      }
      if (sourceRef.current) {
        sourceRef.current.disconnect();
      }
      if (streamRef.current) {
        for (const track of streamRef.current.getTracks()) {
          track.stop();
        }
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
      if (playbackContextRef.current) {
        playbackContextRef.current.close();
      }
    };
  }, []);

  async function ensurePlaybackContext() {
    if (!playbackContextRef.current) {
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      playbackContextRef.current = new AudioContextCtor({ sampleRate: 24000 });
    }

    if (playbackContextRef.current.state === 'suspended') {
      await playbackContextRef.current.resume();
    }

    return playbackContextRef.current;
  }

  async function queuePlaybackChunk(message) {
    const playbackContext = await ensurePlaybackContext();
    const pcm = base64ToInt16(message.audio);
    const samples = new Float32Array(pcm.length);

    for (let index = 0; index < pcm.length; index += 1) {
      samples[index] = pcm[index] / 32768;
    }

    const buffer = playbackContext.createBuffer(message.channels || 1, samples.length, message.sample_rate_hz || 24000);
    buffer.copyToChannel(samples, 0);

    const source = playbackContext.createBufferSource();
    source.buffer = buffer;
    source.connect(playbackContext.destination);

    const startAt = Math.max(playbackContext.currentTime + 0.03, playbackCursorRef.current || 0);
    source.start(startAt);
    playbackCursorRef.current = startAt + buffer.duration;
  }

  async function ensureMicrophone() {
    if (streamRef.current && audioContextRef.current) {
      return true;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      const audioContext = new AudioContextCtor();
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);

      processor.onaudioprocess = (event) => {
        if (!recordingRef.current) {
          return;
        }

        const input = event.inputBuffer.getChannelData(0);
        const downsampled = downsampleTo16k(input, audioContext.sampleRate);
        sampleBufferRef.current.push(...downsampled);

        if (sampleBufferRef.current.length >= 8000) {
          flushChunk();
        }
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

      streamRef.current = stream;
      audioContextRef.current = audioContext;
      processorRef.current = processor;
      sourceRef.current = source;
      setMicReady(true);
      return true;
    } catch {
      setError('Microphone permission denied.');
      setStatus('Unable to access microphone.');
      return false;
    }
  }

  function flushChunk() {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return;
    }

    if (!sampleBufferRef.current.length || !turnIdRef.current) {
      return;
    }

    const chunk = new Float32Array(sampleBufferRef.current.splice(0, 8000));
    const payload = arrayBufferToBase64(encodePcm16(chunk));

    wsRef.current.send(
      JSON.stringify({
        type: 'turn.audio_chunk',
        turn_id: turnIdRef.current,
        sequence: sequenceRef.current,
        audio: payload
      })
    );

    sequenceRef.current += 1;
  }

  async function startRecording() {
    setError('');
    setReply(null);
    setAgentStage(null);
    setAgentActivity([]);
    setFinalTranscript('');
    setPartialTranscript('');
    playbackCursorRef.current = 0;

    const ready = await ensureMicrophone();
    if (!ready || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return;
    }

    sequenceRef.current = 0;
    sampleBufferRef.current = [];
    recordingRef.current = true;
    wsRef.current.send(
      JSON.stringify({
        type: 'turn.start',
        target_agent_id: selectedAgentId,
        audio_format: {
          encoding: 'pcm_s16le',
          sample_rate_hz: 16000,
          channels: 1
        }
      })
    );

    setIsRecording(true);
    setStatus('Recording...');
  }

  function stopRecording() {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return;
    }

    flushChunk();
    recordingRef.current = false;
    wsRef.current.send(
      JSON.stringify({
        type: 'turn.end',
        turn_id: turnIdRef.current
      })
    );
    setIsRecording(false);
    setStatus('Finalizing turn...');
  }

  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) || null;
  const callableAgentIds = reply?.floor?.next_agent_ids || floor?.next_agent_ids || agents.map((agent) => agent.id);
  const suggestedNextAgentIds = reply?.next_agent_suggestions?.length ? reply.next_agent_suggestions : callableAgentIds;

  function agentById(agentId) {
    return agents.find((agent) => agent.id === agentId) || null;
  }

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">Palpa Voice Slice 1</p>
        <h1>Supervisor-managed voice turns, simple specialist handoff.</h1>
        <p className="lede">
          The supervisor manages the floor. You see which specialists are available, who is active now,
          and whether the latest response should be spoken or just rendered.
        </p>
      </section>

      <section className="grid">
        <article className="panel">
          <h2>Floor</h2>
          <dl className="facts">
            <div>
              <dt>Supervisor</dt>
              <dd>{session?.gateway?.name || 'Pending'}</dd>
            </div>
            <div>
              <dt>Role</dt>
              <dd>{session?.gateway?.role || 'Pending'}</dd>
            </div>
            <div>
              <dt>Active agent</dt>
              <dd>{agentById(floor?.active_agent_id)?.name || 'None'}</dd>
            </div>
            <div>
              <dt>Transport</dt>
              <dd>{connectionState}</dd>
            </div>
            <div>
              <dt>Mic</dt>
              <dd>{micReady ? 'Ready' : 'Not granted'}</dd>
            </div>
          </dl>
          <p className="status">{status}</p>
          {error ? <p className="error">{error}</p> : null}
          {session?.warning ? <p className="error">{session.warning}</p> : null}
          <div className="selectorGroup">
            <span className="fieldLabel">Available agents</span>
            <div className="agentList">
              {agents.map((agent) => (
                <button
                  key={agent.id}
                  type="button"
                  className={`agentChip ${selectedAgentId === agent.id ? 'isActive' : ''}`}
                  onClick={() => setSelectedAgentId(agent.id)}
                  disabled={isRecording}
                >
                  <strong>{agent.name}</strong>
                  <span>{agent.role}</span>
                </button>
              ))}
            </div>
            <p className="helperText">
              The supervisor controls the floor. You choose the next specialist to call.
            </p>
          </div>
          <div className="controls">
            <button className="primary" onClick={isRecording ? stopRecording : startRecording} disabled={connectionState !== 'connected'}>
              {isRecording ? `Stop ${selectedAgent?.name || 'Turn'}` : `Call ${selectedAgent?.name || 'Agent'}`}
            </button>
          </div>
        </article>

        <article className="panel">
          <h2>Current turn</h2>
          <dl className="facts">
            <div>
              <dt>Session</dt>
              <dd>{session?.session_id || 'Pending'}</dd>
            </div>
            <div>
              <dt>Turn</dt>
              <dd>{turn?.turn_id || 'Idle'}</dd>
            </div>
            <div>
              <dt>Selected</dt>
              <dd>{selectedAgent?.name || selectedAgentId}</dd>
            </div>
          </dl>
          <div className="transcriptBlock">
            <h3>Live partial</h3>
            <p>{partialTranscript || 'Waiting for provisional transcript...'}</p>
          </div>
          <div className="transcriptBlock">
            <h3>Final</h3>
            <p>{finalTranscript || 'Final transcript will land here after turn end.'}</p>
          </div>
        </article>

        <article className="panel">
          <h2>Reply</h2>
          <dl className="facts">
            <div>
              <dt>From</dt>
              <dd>{reply?.agent_name || 'Pending'}</dd>
            </div>
            <div>
              <dt>Delivery</dt>
              <dd>{reply?.delivery_mode || 'Pending'}</dd>
            </div>
            <div>
              <dt>Read aloud</dt>
              <dd>{reply ? (reply.should_speak ? 'Yes' : 'No') : 'Pending'}</dd>
            </div>
            <div>
              <dt>Next call</dt>
              <dd>{suggestedNextAgentIds.map((agentId) => agentById(agentId)?.name || agentId).join(', ') || 'Pending'}</dd>
            </div>
          </dl>
          {reply?.should_speak ? (
            <div className="transcriptBlock">
              <h3>Spoken</h3>
              <p className="replyText">{reply?.spoken_text || 'The spoken reply will land here.'}</p>
            </div>
          ) : null}
          <div className="transcriptBlock">
            <h3>Rendered</h3>
            <p className="replyText artifactText">{reply?.artifact?.text || reply?.artifact_text || 'The rendered artifact will land here.'}</p>
          </div>
          {reply?.artifact?.files_touched?.length ? (
            <div className="transcriptBlock">
              <h3>Files touched</h3>
              <ul className="activityList">
                {reply.artifact.files_touched.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          ) : null}
          {reply?.artifact?.commands_run?.length ? (
            <div className="transcriptBlock">
              <h3>Commands run</h3>
              <ul className="activityList">
                {reply.artifact.commands_run.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          ) : null}
          {reply?.artifact?.tool_activity?.length ? (
            <div className="transcriptBlock">
              <h3>Tool activity</h3>
              <ul className="activityList">
                {reply.artifact.tool_activity.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          ) : null}
          {reply?.artifact?.diff_summary ? (
            <div className="transcriptBlock">
              <h3>Diff summary</h3>
              <p>{reply.artifact.diff_summary}</p>
            </div>
          ) : null}
          {reply?.warning ? <p className="error">{reply.warning}</p> : null}
          <p className="status">{reply?.should_speak ? 'This reply is being read aloud and rendered.' : 'This reply is render-only.'}</p>
        </article>

        <article className="panel">
          <h2>Next agents</h2>
          <dl className="facts">
            <div>
              <dt>Supervisor</dt>
              <dd>{floor?.supervisor_name || session?.gateway?.name || 'Pending'}</dd>
            </div>
            <div>
              <dt>Stage</dt>
              <dd>{agentStage?.stage || 'Idle'}</dd>
            </div>
            <div>
              <dt>Thread</dt>
              <dd>{agentStage?.thread_id || reply?.thread_id || 'Pending'}</dd>
            </div>
            <div>
              <dt>Codex turn</dt>
              <dd>{agentStage?.codex_turn_id || 'Pending'}</dd>
            </div>
          </dl>
          <div className="transcriptBlock">
            <h3>Call next</h3>
            <div className="agentList">
              {suggestedNextAgentIds.map((agentId) => {
                const agent = agentById(agentId);
                if (!agent) {
                  return null;
                }

                return (
                  <button
                    key={agent.id}
                    type="button"
                    className={`agentChip ${selectedAgentId === agent.id ? 'isActive' : ''}`}
                    onClick={() => setSelectedAgentId(agent.id)}
                    disabled={isRecording}
                  >
                    <strong>{agent.name}</strong>
                    <span>{agent.role}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="transcriptBlock">
            <h3>Recent activity</h3>
            {agentActivity.length ? (
              <ul className="activityList">
                {agentActivity.map((item, index) => (
                  <li key={`${item.timestamp}-${index}`}>
                    <strong>{item.kind || 'activity'}</strong>
                    <pre className="codeBlock">
                      <code>{formatActivityPayload(item)}</code>
                    </pre>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No live agent activity has been emitted for this turn yet.</p>
            )}
          </div>
          {agentStage?.error ? <p className="error">{agentStage.error}</p> : null}
        </article>
      </section>
    </main>
  );
}
