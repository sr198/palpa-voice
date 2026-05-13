# Palpa Voice Slice 1 Spec

## 1. Objective

Build the first end-to-end Palpa voice slice that proves two-way voice interaction between a human in the browser and a mock AI participant.

This slice must validate:

1. Human speech can be captured in the browser.
2. Live or near-live transcription can be produced locally using Whisper.
3. The system converts speech into Palpa-owned transcript events.
4. The orchestration layer can choose a mock role and generate a reply.
5. The reply can be synthesized locally using Kokoro in a role-specific voice.
6. The browser can play the synthesized reply back to the user.

This is a product-shaping slice, not a throwaway demo.

## 2. Product Intent

Palpa is not building a voice chatbot. Palpa is building voice infrastructure for human-agent collaboration.

For Slice 1, the most important design constraint is:

`audio is transport, transcript events are product state`

That means raw microphone audio is transient transport input, while transcripts, turn boundaries, speaker identity, role attribution, and reply metadata are the real system outputs.

## 3. Locked Stack Decisions

### Frontend

- `Next.js`
- App Router
- Browser APIs for microphone capture and audio playback

Why:

- This work should grow into the broader Palpa platform.
- Next.js is the right long-term frontend foundation for app shell, collaboration UI, routing, and future realtime surfaces.

### Main backend

- `Node.js`
- `Fastify`
- WebSocket-first transport for live session traffic
- JSON schema-driven internal contracts where practical

Why:

- Fastify should own browser sessions, event orchestration, contracts, and coordination across services.
- Node is the right place to integrate future external agent SDKs, app state, session policy, and realtime fan-out.

### AI service layer

- `Python` service for ASR
- `Python` service for TTS, or one combined Python voice service if that is simpler initially

Why:

- Python is justified only where model runtime and inference stack require it.
- Whisper and Kokoro both fit naturally into Python-serving workflows.

### Infra/runtime

- `Whisper` running locally
- `Kokoro` running locally
- English-only for Slice 1

Why:

- Local inference preserves control over latency, privacy, model replacement, and future fine-tuning.
- English-only keeps the implementation narrow enough to complete quickly.

## 4. Key Architecture Decision

Do not adopt a third-party ASR server architecture wholesale.

We will build a thin Palpa-owned transcription engine and borrow implementation ideas from projects such as WhisperLive where useful.

What we own:

- Turn/session protocol
- WebSocket message contracts
- Transcript event schema
- Fastify orchestration integration
- Model adapter boundary

What we may borrow:

- Audio chunk sizing
- Voice activity detection strategy
- Partial transcript emission patterns
- Buffering approaches
- Model preload and reuse patterns

## 5. Scope of Slice 1

### In scope

- Single-user browser interaction
- Microphone capture in browser
- Audio streaming or chunk upload from browser to Fastify
- Fastify session/turn lifecycle
- Forwarding audio to Python ASR service
- Partial and final transcript generation
- Transcript event creation in Fastify
- Mock role selection
- Mock reply generation from fixed templates
- Forwarding reply text to Python TTS service
- Kokoro synthesis in randomly selected role voice
- Playback in browser
- Basic status, errors, and timings

### Out of scope

- Real Codex or Claude agent participation
- Multi-user rooms
- Floor control
- Interruptions and barge-in handling
- Persistent conversation storage
- Production observability stack
- Multi-language routing
- Fine-tuned Whisper model integration
- Role governance and approval flows

## 6. User Experience Goal

The user opens the Palpa voice screen, speaks naturally, sees live or near-live text appear, then hears a spoken reply from a mock role such as Architect, Facilitator, or Operator.

The interaction should feel like a conversation turn, not like uploading a recording to a batch job.

## 7. End-to-End Flow

### Target flow

1. Browser opens a Palpa voice session.
2. Browser establishes a WebSocket connection to Fastify.
3. User presses and holds to talk, or uses simple start/stop recording controls.
4. Browser captures microphone audio and sends chunked audio frames to Fastify.
5. Fastify creates a `turn_id` and forwards chunks to the Python ASR service.
6. Python ASR service buffers audio, runs VAD and Whisper inference, and emits partial transcripts.
7. Fastify relays partial transcripts to the browser.
8. When the turn ends, Python ASR service emits a final transcript.
9. Fastify creates a Palpa transcript event from the final transcript.
10. Fastify randomly selects a mock role and reply template.
11. Fastify sends the reply text and selected voice id to the Python TTS service.
12. Python TTS service synthesizes audio using Kokoro and returns the audio payload or a retrievable audio resource.
13. Fastify sends reply metadata and playback information to the browser.
14. Browser renders the role-attributed reply and plays the audio.

## 8. Service Topology

### Frontend service

- Next.js app
- Responsibilities:
  - session UI
  - mic controls
  - transcript rendering
  - reply rendering
  - audio playback
  - connection state

### Orchestration service

- Fastify app
- Responsibilities:
  - session creation
  - websocket handling
  - turn state machine
  - transcript event creation
  - mock role selection
  - mock reply generation
  - calling Python ASR/TTS services
  - timing and audit metadata

### Voice service

- Python service
- Responsibilities:
  - audio normalization
  - buffering
  - VAD
  - Whisper inference
  - Kokoro inference
  - emitting ASR partials/finals
  - returning synthesized audio

## 9. Communication Model

### Browser to Fastify

Use WebSocket for the main session path.

Reason:

- Live and near-live transcription works better with incremental events.
- We will need the same transport later for agent messages, room events, and realtime collaboration state.

### Fastify to Python

Two acceptable options for Slice 1:

1. HTTP for control messages plus WebSocket for streaming transcription
2. Pure WebSocket if that keeps the implementation simpler

Preferred initial direction:

- WebSocket for ASR stream
- HTTP for TTS request/response

Reason:

- ASR is stateful and incremental.
- TTS is naturally request/response for this slice.

## 10. Turn Model

Each human utterance is a turn.

A turn has:

- `session_id`
- `turn_id`
- `speaker`
- `state`
- `started_at`
- `ended_at`
- `partial_transcript`
- `final_transcript`
- `reply_role`
- `reply_text`
- `reply_voice`

### Turn states

- `idle`
- `recording`
- `transcribing`
- `finalized`
- `reply_generating`
- `synthesizing`
- `completed`
- `error`

## 11. ASR Design

### Core decision

Build a custom thin transcription engine.

### Model

- Start with standard Whisper-compatible local inference
- Prefer `faster-whisper` implementation if it gives acceptable setup and latency
- Use a single preloaded English model instance for Slice 1

### Language support

- `English only`

This should be explicit in both code and UI. Do not pretend multi-language support exists yet.

### Transcription mode

Target near-live transcription, not offline batch transcription.

That means:

- audio arrives in chunks
- partial transcripts are emitted during a turn
- final transcript is emitted at turn end

### VAD

Use VAD to help determine speech start and end.

VAD is useful because it:

- reduces unnecessary decode attempts
- improves responsiveness
- helps detect end-of-turn without requiring overly rigid UI controls

For Slice 1, VAD can be simple and conservative.

### Chunking

Initial recommendation:

- browser captures small audio chunks
- target chunk duration around `500ms` to `1000ms`

This is a starting point, not a fixed requirement. Final chunk sizing should be tuned by latency tests.

### Partial transcript behavior

Partials should be treated as provisional UI hints.

They:

- may change
- are not product state
- should not be written as durable transcript events

Only final transcripts become Palpa transcript events.

## 12. TTS Design

### Core decision

Use Kokoro locally behind a Python service boundary.

### Reply voice model

Each mock role maps to one or more Kokoro voice IDs.

Example:

- `Architect -> af_bella`
- `Facilitator -> af_heart`
- `Operator -> af_nova`

The orchestration layer randomly picks a role and voice from the available registry for the turn.

### Output

The TTS service should return:

- provider name
- voice id
- audio format
- audio payload or URL/reference
- synthesis duration if available

## 13. Mock Role and Reply Design

Slice 1 should not use an LLM for reply generation.

Reply generation should be:

- local
- deterministic or semi-deterministic
- role-attributed

The role registry should contain:

- role id
- display name
- available voice ids
- a small set of canned replies

Fastify randomly selects:

1. a role
2. a voice for that role
3. a canned reply

This is enough to validate the voice roundtrip without introducing agent reasoning as a confounder.

## 14. Event Model

### Product principle

Transcript events are product events.

Audio transport events are operational events.

### Minimum event types

- `voice.turn.started`
- `voice.turn.partial_transcript`
- `voice.turn.final_transcript`
- `voice.reply.selected`
- `voice.reply.synthesized`
- `voice.turn.completed`
- `voice.turn.failed`

### Example final transcript event

```json
{
  "type": "voice.turn.final_transcript",
  "session_id": "session_001",
  "turn_id": "turn_001",
  "speaker": "human",
  "language": "en",
  "text": "Can you summarize the architecture boundary for this voice collaboration slice?",
  "source": {
    "provider": "local-whisper",
    "model": "base.en"
  },
  "timing": {
    "recording_started_at": "2026-05-13T15:00:00.000Z",
    "finalized_at": "2026-05-13T15:00:03.600Z"
  }
}
```

### Example reply selected event

```json
{
  "type": "voice.reply.selected",
  "session_id": "session_001",
  "turn_id": "turn_001",
  "role": {
    "id": "architect",
    "name": "Architect"
  },
  "reply": {
    "text": "Keep audio transport separate from agent context so downstream agents consume transcript events, not raw audio.",
    "voice_id": "af_bella"
  }
}
```

## 15. Browser-to-Fastify Message Shapes

These are draft message contracts for implementation.

### Client to server

#### `session.start`

```json
{
  "type": "session.start",
  "session_id": "session_001"
}
```

#### `turn.start`

```json
{
  "type": "turn.start",
  "session_id": "session_001",
  "turn_id": "turn_001",
  "audio": {
    "encoding": "pcm_s16le",
    "sample_rate_hz": 16000,
    "channels": 1
  }
}
```

#### `turn.audio_chunk`

```json
{
  "type": "turn.audio_chunk",
  "session_id": "session_001",
  "turn_id": "turn_001",
  "seq": 12,
  "payload_base64": "<audio-bytes>"
}
```

#### `turn.end`

```json
{
  "type": "turn.end",
  "session_id": "session_001",
  "turn_id": "turn_001"
}
```

### Server to client

#### `turn.partial_transcript`

```json
{
  "type": "turn.partial_transcript",
  "session_id": "session_001",
  "turn_id": "turn_001",
  "text": "Can you summarize",
  "is_final": false
}
```

#### `turn.final_transcript`

```json
{
  "type": "turn.final_transcript",
  "session_id": "session_001",
  "turn_id": "turn_001",
  "text": "Can you summarize the architecture boundary for this voice collaboration slice?",
  "is_final": true
}
```

#### `reply.ready`

```json
{
  "type": "reply.ready",
  "session_id": "session_001",
  "turn_id": "turn_001",
  "role": "Architect",
  "voice_id": "af_bella",
  "text": "Keep audio transport separate from agent context so downstream agents consume transcript events, not raw audio.",
  "audio_url": "/api/audio/reply/session_001/turn_001.wav"
}
```

## 16. Fastify-to-Python Service Contract

This can evolve during implementation, but the contract boundary should stay narrow.

### ASR operations

- `start_turn`
- `append_audio_chunk`
- `end_turn`
- `cancel_turn`

### ASR events

- `partial_transcript`
- `final_transcript`
- `turn_error`

### TTS operation

- `synthesize`

TTS input:

- `text`
- `voice_id`
- `output_format`

TTS output:

- `audio bytes or file reference`
- `voice_id`
- `provider`
- `duration_ms if available`

## 17. Latency Targets

These are target goals, not release gates.

### ASR

- first partial transcript: `under 1500ms` after speech begins
- final transcript: `under 2000ms` after turn ends

### TTS

- reply synthesis start to playable audio: `under 2000ms`

### Full roundtrip

- end of human utterance to audible system reply: `under 4000ms`

If local Whisper on the target hardware cannot meet this with acceptable accuracy, that is a useful finding from the slice.

## 18. Fallback Strategy

Primary architecture remains local Whisper and local Kokoro.

Fallbacks may exist for development only:

- manual push-to-talk if VAD is unstable
- no partial transcripts if partial decoding is too noisy
- browser TTS only for local debugging if Kokoro setup blocks progress

Do not make browser ASR the primary path.

Reason:

- browser speech recognition is not a reliable cross-browser platform primitive
- it weakens Palpa ownership of the voice infrastructure layer

## 19. Observability Requirements

For each turn, capture at least:

- session id
- turn id
- recording started time
- recording ended time
- first partial transcript time
- final transcript time
- reply selected time
- TTS requested time
- TTS completed time
- playback started time if available
- error state if any

This data can be console logs or in-memory debug state for Slice 1.

## 20. Risks

### Whisper latency may be too slow

Mitigation:

- use a smaller English model first
- use `faster-whisper`
- use VAD
- keep turn lengths short

### Browser audio format mismatch

Mitigation:

- normalize audio in Fastify or Python
- standardize on mono 16 kHz PCM before inference

### Kokoro setup complexity

Mitigation:

- keep TTS service API narrow
- start with one or two voices
- defer advanced voice controls

### Overbuilding

Mitigation:

- no real agents
- no persistence
- no generalized plugin system
- one session path
- one language

## 21. Success Criteria

Slice 1 is successful if:

1. A user can speak from the browser and see transcript text appear.
2. A final transcript is created and treated as a Palpa event.
3. A mock role is visibly selected for the response.
4. A Kokoro voice reads the reply back audibly.
5. The system shape clearly supports future replacement of:
   - stock Whisper with a fine-tuned English model
   - mock role replies with real agent orchestration
   - single-user session flow with broader huddle semantics

## 22. Implementation Sequence

### Phase 1

- Next.js voice screen
- Fastify websocket session
- browser audio capture
- basic turn controls

### Phase 2

- Python ASR service
- chunk buffering
- final transcript generation

### Phase 3

- partial transcript support
- VAD integration
- latency measurement

### Phase 4

- mock role registry
- Kokoro TTS
- reply playback

### Phase 5

- event cleanup
- error handling
- dev ergonomics

## 23. Explicit Non-Decisions For Later

These are intentionally deferred:

- whether ASR and TTS stay in one Python service or split into two
- whether Python communicates with Fastify over HTTP, WS, gRPC, or another transport long term
- which fine-tuning approach will be used for future non-English or domain-specific models
- whether future huddles use streaming speech-to-speech or transcript-first turn-taking

## 24. Final Build Constraint

Do not let Slice 1 collapse into a generic demo app.

Every implementation choice should preserve this future architecture:

`Next.js collaboration surface -> Fastify orchestration layer -> Python voice inference services -> Palpa transcript/reply events -> future governed agent runtime`
