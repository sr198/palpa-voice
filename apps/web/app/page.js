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

export default function Home() {
  const [connectionState, setConnectionState] = useState('connecting');
  const [session, setSession] = useState(null);
  const [agents, setAgents] = useState([]);
  const [skills, setSkills] = useState([]);
  const [apps, setApps] = useState([]);
  const [selectedAgentId, setSelectedAgentId] = useState('architect');
  const [turn, setTurn] = useState(null);
  const [partialTranscript, setPartialTranscript] = useState('');
  const [finalTranscript, setFinalTranscript] = useState('');
  const [reply, setReply] = useState(null);
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
        setSkills(message.skills || []);
        setApps(message.apps || []);
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
          skills_used: message.skills_used || []
        }));
        setStatus(`Reply selected: ${message.agent_name}.`);
      }

      if (message.type === 'reply.ready') {
        playbackCursorRef.current = 0;
        setStatus('Synthesized audio stream starting.');
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

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">Palpa Voice Slice 1</p>
        <h1>Human speech in, transcript events out, role-attributed voice back.</h1>
        <p className="lede">
          One active session, one active turn, and one most-recent reply. The browser only owns capture,
          rendering, and playback.
        </p>
      </section>

      <section className="grid">
        <article className="panel">
          <h2>Session</h2>
          <dl className="facts">
            <div>
              <dt>Transport</dt>
              <dd>{connectionState}</dd>
            </div>
            <div>
              <dt>Session</dt>
              <dd>{session?.session_id || 'Pending'}</dd>
            </div>
            <div>
              <dt>Turn</dt>
              <dd>{turn?.turn_id || 'Idle'}</dd>
            </div>
            <div>
              <dt>Mic</dt>
              <dd>{micReady ? 'Ready' : 'Not granted'}</dd>
            </div>
            <div>
              <dt>Agent</dt>
              <dd>{selectedAgentId}</dd>
            </div>
            <div>
              <dt>Skills</dt>
              <dd>{skills.length}</dd>
            </div>
            <div>
              <dt>Apps</dt>
              <dd>{apps.length}</dd>
            </div>
          </dl>
          <p className="status">{status}</p>
          {error ? <p className="error">{error}</p> : null}
          {session?.warning ? <p className="error">{session.warning}</p> : null}
          <div className="selectorGroup">
            <label className="fieldLabel" htmlFor="agent-select">
              Voice target
            </label>
            <select id="agent-select" value={selectedAgentId} onChange={(event) => setSelectedAgentId(event.target.value)} disabled={isRecording || !agents.length}>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name} · {agent.role}
                </option>
              ))}
            </select>
            <p className="helperText">
              The gateway keeps routing explicit for now. You choose which specialist receives the turn.
            </p>
          </div>
          <div className="controls">
            <button className="primary" onClick={isRecording ? stopRecording : startRecording} disabled={connectionState !== 'connected'}>
              {isRecording ? 'Stop Turn' : 'Push To Talk'}
            </button>
          </div>
        </article>

        <article className="panel">
          <h2>Transcript</h2>
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
              <dt>Gateway</dt>
              <dd>{reply?.gateway_name || session?.gateway?.name || 'Pending'}</dd>
            </div>
            <div>
              <dt>Agent</dt>
              <dd>{reply?.agent_name || 'Pending'}</dd>
            </div>
            <div>
              <dt>Role</dt>
              <dd>{reply?.agent_role || 'Pending'}</dd>
            </div>
            <div>
              <dt>Voice</dt>
              <dd>{reply?.voice_id || 'Pending'}</dd>
            </div>
            <div>
              <dt>Mode</dt>
              <dd>{reply?.mode || 'Pending'}</dd>
            </div>
            <div>
              <dt>Provider</dt>
              <dd>{reply?.provider || 'Pending'}</dd>
            </div>
            <div>
              <dt>Thread</dt>
              <dd>{reply?.thread_id || 'Pending'}</dd>
            </div>
          </dl>
          <div className="transcriptBlock">
            <h3>Spoken reply</h3>
            <p className="replyText">{reply?.spoken_text || 'The TTS-safe spoken reply will land here.'}</p>
          </div>
          <div className="transcriptBlock">
            <h3>Artifact text</h3>
            <p className="replyText artifactText">{reply?.artifact_text || 'The richer artifact text will render here separately from speech.'}</p>
          </div>
          <div className="transcriptBlock">
            <h3>Skills used</h3>
            <p>{reply?.skills_used?.length ? reply.skills_used.join(', ') : 'No explicit repo skill attachments were used for this turn.'}</p>
          </div>
          {reply?.warning ? <p className="error">{reply.warning}</p> : null}
          <p className="status">Playback is streamed progressively over Web Audio.</p>
        </article>
      </section>
    </main>
  );
}
