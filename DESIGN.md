# Palpa Voice — System Design

## Overview

Palpa Voice is a voice-first interface to a set of AI specialists (Architect, Orchestrator, Voice Lead, Frontend). The user speaks; the system transcribes, routes the query to the right agent, synthesizes a spoken reply, and streams audio back — all in real time.

Three services collaborate:

```
Browser (Next.js :3000)
  ↕  WebSocket
Fastify API (:3001)   ←→  Codex app-server (local process, stdio JSON-RPC)
  ↕  WebSocket / HTTP
Python Voice Service (:8000)   ← Whisper (ASR) + Kokoro (TTS)
```

---

## End-to-End Data Flow

### 1. Voice Capture (Browser)

**File:** [apps/web/app/page.js](apps/web/app/page.js)

The user holds Push-to-Talk. The browser:

1. Acquires the microphone via `getUserMedia({ audio: true })`.
2. Creates a Web Audio `ScriptProcessor` (4096-sample buffer) at the native device rate (typically 48 kHz).
3. Downsamples to **16 kHz** via `downsampleTo16k()` — a simple averaging resampler matching Whisper's expected rate.
4. Encodes each 0.5-second window (8 000 samples) to **signed 16-bit little-endian PCM** and base64-encodes it.
5. Sends it over WebSocket as a `turn.audio_chunk` message.

Key messages sent by the browser:

| Message | When | Key fields |
|---|---|---|
| `turn.start` | PTT pressed | `turn_id`, `audio_format` |
| `turn.audio_chunk` | Every 0.5 s | `turn_id`, `sequence`, `audio` (base64 PCM16) |
| `turn.end` | PTT released | `turn_id` |

---

### 2. Audio Buffering & Turn Management (Fastify)

**Files:** [apps/api/src/app.js](apps/api/src/app.js), [apps/api/src/session-store.js](apps/api/src/session-store.js)

`SessionStore.handleMessage()` routes every WebSocket message by `type`:

- **`turn.start`** — creates a `Turn` object (`state: 'recording'`), opens a fresh WebSocket to the Python ASR endpoint (`/asr`), and forwards a `start_turn` message.
- **`turn.audio_chunk`** — validates the 8 MB buffer cap, then relays the chunk verbatim to the ASR socket.
- **`turn.end`** — transitions turn to `'transcribing'` and sends `end_turn` to the ASR socket.

Turn object (abbreviated):

```js
{
  id: 'turn_xxxxx',
  state: 'recording' | 'transcribing' | 'reply_generating' | 'synthesizing' | 'completed' | 'error',
  audioFormat: { encoding: 'pcm_s16le', sample_rate_hz: 16000, channels: 1 },
  finalTranscript: '',
  targetAgentId: 'architect',   // user-selected specialist
  asrClient: WebSocket          // connection to Python voice service
}
```

---

### 3. ASR / Transcription (Python Voice Service)

**File:** [services/voice/main.py](services/voice/main.py)

The Python service accumulates audio chunks in a `TurnBuffer`. On every **2nd partial chunk** it runs a quick Whisper pass over the first 3 seconds of audio and emits a `partial_transcript`. On `end_turn` it transcribes the full buffer and emits a `final_transcript`.

**Model:** `faster-whisper` with the `tiny.en` model, `int8` quantization, CPU-only.  
**Fallback:** `mock-whisper` returns a canned transcript if the model is absent.

Raw PCM bytes are wrapped in a WAV container (via `pcm16_to_wav_bytes()`) before being fed to Whisper.

Events sent back to Fastify over the ASR WebSocket:

```jsonc
// Every 2 chunks while recording
{ "type": "partial_transcript", "turn_id": "...", "text": "Can you..." }

// After end_turn
{
  "type": "final_transcript",
  "turn_id": "...",
  "text": "Can you summarize the architecture?",
  "provider": "faster-whisper",
  "provider_metadata": { "model": "tiny.en", "language": "en", "duration": 3.5 }
}
```

---

### 4. Agent Routing & Codex Processing (Fastify → Codex)

**Files:** [apps/api/src/session-store.js](apps/api/src/session-store.js), [apps/api/src/agents.js](apps/api/src/agents.js), [apps/api/src/codex-client.js](apps/api/src/codex-client.js)

When a `final_transcript` arrives, `generateReply()` is called.

#### Agent Registry

Four specialists, each with a dedicated voice:

| ID | Name | Role | Voice |
|---|---|---|---|
| `architect` | Architect | System design & boundaries | `af_bella` |
| `orchestrator` | Orchestrator | Cross-service coordination | `af_heart` |
| `voice-lead` | Voice Lead | Audio pipeline & UX | `af_nova` |
| `frontend` | Frontend | UI, state, browser APIs | `af_bella` |

#### Codex App-Server Client

`CodexAppServerClient` spawns:

```
codex app-server --listen stdio://
```

Communication is **JSON-RPC 2.0 over stdin/stdout**. The client tracks in-flight requests and dispatches notifications to registered listeners.

#### Thread Lifecycle

Each session maintains a **persistent Codex thread per specialist** in `session.agentState.threadsByAgentId`. The first query to an agent calls `thread/start` (with `approvalPolicy: 'never'`, `sandbox: 'workspace-write'`, and a role-specific `developerInstructions` prompt). Subsequent queries reuse the same thread, so context accumulates across turns.

#### Turn Execution

1. `ensureRoleThread()` — gets or creates the agent's Codex thread.
2. `buildTurnPrompt()` — assembles the prompt:
   ```
   Selected role: Architect
   Transcript from the human: Can you summarize the architecture?

   Reply as the selected role.
   Keep spoken_text short and natural for TTS.
   Put denser implementation detail in artifact_text.
   ```
3. `turn/start` — sends to Codex with attached skills (`voice-mode`, `architect-voice`) and an **output schema**:
   ```jsonc
   {
     "required": ["spoken_text", "artifact_text", "topics"],
     "properties": {
       "spoken_text": { "type": "string" },   // short, TTS-safe
       "artifact_text": { "type": "string" }, // richer detail
       "topics": { "type": "array" }
     }
   }
   ```
4. `waitForTurnCompleted()` — blocks up to 30 s for the `turn/completed` notification.
5. `thread/read` — fetches the final message and extracts the JSON block via `parseStructuredReply()`.

**Fallback:** if Codex is unavailable or times out, `createFallbackAgentReply()` returns a keyword-matched generic response so the system remains functional.

The `reply.selected` message sent to the browser:

```jsonc
{
  "type": "reply.selected",
  "agent_id": "architect",
  "agent_name": "Architect",
  "voice_id": "af_bella",
  "spoken_text": "Keep audio transport separate from...",
  "artifact_text": "Detailed architecture notes...",
  "topics": ["voice", "architecture"],
  "provider": "codex-app-server",
  "mode": "live"
}
```

---

### 5. TTS Synthesis & Streaming (Python Voice Service → Browser)

**Files:** [services/voice/main.py](services/voice/main.py), [apps/api/src/session-store.js](apps/api/src/session-store.js), [apps/web/app/page.js](apps/web/app/page.js)

#### Synthesis

Fastify POSTs to `/tts/stream` with `{ text, voice_id, output_format: 'wav' }`. The Python service uses **Kokoro** to generate audio and streams chunks as **NDJSON** (newline-delimited JSON):

```jsonc
// One per chunk
{ "type": "audio_chunk", "sequence": 0, "audio": "<base64 PCM16>", "sample_rate_hz": 24000, "encoding": "pcm_s16le" }

// Once at the end
{ "type": "audio_end", "voice_id": "af_bella", "provider": "kokoro", "duration_ms": 850 }
```

**Fallback:** if Kokoro is absent, a 440 Hz or 554 Hz test tone is streamed instead.

#### Relay

Fastify parses the NDJSON stream and relays each event to the browser WebSocket as `reply.audio_chunk` / `reply.audio_end`.

#### Playback

The browser queues chunks into the Web Audio API using **gapless scheduling**:

```js
const startAt = Math.max(ctx.currentTime + 0.03, playbackCursorRef.current);
source.start(startAt);
playbackCursorRef.current = startAt + buffer.duration;
```

Each chunk is decoded from base64 PCM16 → Float32, wrapped in an `AudioBuffer`, and scheduled to begin exactly when the previous chunk ends (30 ms lookahead). The AudioContext is fixed at **24 kHz** to match Kokoro's output.

---

## Session Lifecycle

```
browser                    fastify                  python          codex
  |                           |                       |               |
  |--- session.start -------->|                       |               |
  |<-- session.started -------|                       |               |
  |                           |                       |               |
  |--- turn.start ----------->|--- start_turn WS ---->|               |
  |<-- turn.started ----------|                       |               |
  |                           |                       |               |
  |--- turn.audio_chunk* ---->|--- append_audio_chunk*>|               |
  |<-- turn.partial_transcript| <-- partial_transcript |               |
  |                           |                       |               |
  |--- turn.end ------------->|--- end_turn --------->|               |
  |                           | <-- final_transcript--|               |
  |<-- turn.final_transcript--|                       |               |
  |                           |--- turn/start ----------------------->|
  |                           | <-- turn/completed -------------------|
  |                           |--- thread/read ---------------------->|
  |<-- reply.selected --------|                       |               |
  |                           |--- POST /tts/stream ->|               |
  |<-- reply.audio_chunk* ----|<-- NDJSON chunks* ----|               |
  |<-- reply.audio_end -------|<-- audio_end ----------|              |
  |<-- turn.completed --------|                       |               |
```

---

## Configuration

**File:** [apps/api/src/config.js](apps/api/src/config.js)

| Setting | Default | Env var |
|---|---|---|
| API port | `3001` | `API_PORT` |
| Voice WS URL | `ws://127.0.0.1:8000/asr` | `VOICE_WS_URL` |
| Voice TTS stream URL | `http://127.0.0.1:8000/tts/stream` | `VOICE_TTS_STREAM_URL` |
| Max turn buffer | 8 MB | `MAX_TURN_BYTES` |
| Codex turn timeout | 30 s | `CODEX_TURN_TIMEOUT_MS` |
| Codex model | (Codex default) | `CODEX_MODEL` |

---

## Error Handling

| Failure | Behaviour |
|---|---|
| ASR WebSocket drops | `failTurn()` → `turn.error` to browser |
| Transcript empty | Turn silently discarded |
| Codex timeout (30 s) | Fallback reply with generic response |
| Codex process exits | All pending requests rejected |
| Python TTS unreachable | `turn.error` to browser |
| Buffer > 8 MB | `turn.error`, connection closed |

---

## Key Architectural Principles

- **Session-centric threads.** Codex threads live on the session, not the turn. Context accumulates across the full conversation.
- **Structured agent output.** Codex must return JSON with `spoken_text` (TTS-safe) and `artifact_text` (display-only). This keeps TTS concise while preserving rich detail for the UI.
- **Local inference.** Whisper and Kokoro run on-device — no cloud round trips for audio, preserving latency and privacy.
- **Service boundary clarity.** Python owns model inference only. Fastify owns orchestration, session state, and event tracking. The browser owns audio I/O and rendering.
- **Graceful fallback at every layer.** Mock ASR, mock TTS, and fallback agent replies keep the system usable even when models or Codex are unavailable.
