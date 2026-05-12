This is a **core Palpa subsystem**, not a side widget.

The right mental model:

> **Palpa Voice Engine is the realtime conversation operating system for human-agent software teams.**
> It turns audio into typed events, manages the floor, routes work to agents, speaks through TTS, writes to the canvas/work graph, and preserves human governance.

This fits the existing Palpa direction: voice huddles belong in the collaboration layer over the Palpa control plane and typed graph, and external agents should be governed room participants through Agent Packs/adapters rather than raw CLI sessions.  

---

# 1. Strong product call

We should **not** build “a voice chatbot.”

We should build a **voice-first collaboration canvas** with these primitives:

```text
Audio stream
  → speech segments
  → attributed utterances
  → semantic events
  → floor decisions
  → agent requests
  → canvas/work graph changes
  → spoken + visual responses
  → audit/replay trail
```

The key is that **voice is not only input/output**. Voice becomes a first-class source of Palpa events:

```text
Human says something
Human asks Palpa
Agent requests the floor
Decision is proposed
Decision is locked
Work item is drafted
Architecture risk is raised
Incident mitigation is proposed
TTS starts
Human interrupts agent
Agent speech is cancelled
```

So the engine is event-native from day one.

---

# 2. Reference architecture

```text
┌─────────────────────────────────────────────────────────────┐
│ Palpa Huddle UI                                             │
│ browser/native app, canvas, transcript, controls, mic/speaker│
└───────────────────────────────┬─────────────────────────────┘
                                │ WebRTC audio/data
                                ▼
┌─────────────────────────────────────────────────────────────┐
│ Realtime Media Plane                                         │
│ LiveKit/WebRTC room, per-user audio tracks, agent audio track │
└───────────────────────────────┬─────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────┐
│ Palpa Voice Engine                                           │
│                                                             │
│  Audio Frontend                                              │
│   - VAD                                                       │
│   - echo handling                                             │
│   - turn segmentation                                         │
│   - audio buffering                                           │
│                                                             │
│  Speech Intelligence                                          │
│   - streaming ASR                                             │
│   - transcript revision                                       │
│   - speaker attribution / diarization                         │
│   - command and speech-act detection                          │
│                                                             │
│  Conversation Control                                         │
│   - floor manager                                             │
│   - barge-in handling                                         │
│   - agent speech budget                                       │
│   - interruption and resume policy                            │
│                                                             │
│  Agent Participation Broker                                   │
│   - routes events to supervisor/concrete agents               │
│   - validates agent contributions                             │
│   - asks for / grants / denies floor                          │
│                                                             │
│  TTS Outbound                                                 │
│   - Kokoro service                                            │
│   - streaming audio chunks                                    │
│   - cancellation tokens                                       │
└───────────────────────────────┬─────────────────────────────┘
                                │ typed events
                                ▼
┌─────────────────────────────────────────────────────────────┐
│ Palpa Platform                                               │
│ Event bus, graph, canvas, work graph, gates, audit, MCP,      │
│ Agent Packs, Claude/Codex adapters, incident/workflow engine  │
└─────────────────────────────────────────────────────────────┘
```

For the media layer, I would start with **LiveKit** rather than building our own WebRTC/SFU stack. LiveKit is open source, WebRTC-based, supports realtime audio/video/data, and its agent framework can run programmatic participants inside rooms, which maps well to Palpa’s “agent as room participant” model. ([GitHub][1])

---

# 3. The core stack recommendation

| Layer               | Recommended MVP stack                                                        | Why                                                                                                                                                                                                                                                         |
| ------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Realtime media      | **LiveKit + WebRTC + Opus**                                                  | Handles multi-user audio, per-participant tracks, data channels, room semantics, and later telephony/native clients.                                                                                                                                        |
| Event bus           | **NATS JetStream**                                                           | Low-latency pub/sub with persisted streams and replay for huddle/session events. JetStream explicitly supports storing and replaying messages. ([NATS Docs][2])                                                                                             |
| Durable workflows   | **Temporal**                                                                 | Good for long-running workflows: agent investigations, review gates, incident flows, async TTS/ASR jobs. Temporal describes itself as durable execution with resilient workflows and retries. ([GitHub][3])                                                 |
| Observability       | **OpenTelemetry**                                                            | Needed because voice latency, ASR, TTS, floor arbitration, agent routing, and graph writes must be traceable together. OTel covers traces, metrics, and logs. ([OpenTelemetry][4])                                                                          |
| ASR MVP             | **Adapter pattern: hosted realtime ASR + local Whisper/faster-whisper path** | Keep provider-replaceable. OpenAI’s realtime transcription streams deltas as audio arrives; Whisper is multilingual and robust; faster-whisper claims up to 4x faster inference than the original implementation with less memory. ([OpenAI Developers][5]) |
| VAD                 | **Silero VAD**, WebRTC VAD fallback                                          | Silero is lightweight and fast; its repo claims 30ms+ chunks can take under 1ms on one CPU thread. ([GitHub][6])                                                                                                                                            |
| Speaker diarization | **Track identity first; pyannote/diart for shared-room mic**                 | Remote participants already have separate tracks. For physical rooms, pyannote and Diart are strong options; Diart is specifically built for realtime speaker diarization. ([GitHub][7])                                                                    |
| TTS                 | **Kokoro as default Palpa voice service**                                    | Kokoro is open-weight, lightweight, and Apache-licensed; its repo describes Kokoro-82M as fast and cost-efficient. ([GitHub][8])                                                                                                                            |
| Agent interface     | **Palpa MCP Server + Agent Pack adapters**                                   | MCP resources/tools let agents consume Palpa context and invoke controlled actions; this aligns with our Agent Pack strategy. ([Model Context Protocol][9])                                                                                                 |

My vote: **LiveKit + NATS JetStream + Kokoro + VAD + ASR adapter + Palpa Floor Manager** as the first serious prototype.

---

# 4. Important distinction: full duplex does not mean everyone talks all the time

Full duplex means:

```text
Humans can speak while the agent is speaking.
The system keeps listening while TTS is playing.
Humans can interrupt the agent.
The agent can think while humans talk.
The agent cannot speak unless floor policy allows it.
```

So Palpa should have two independent channels:

```text
Audio Duplex Channel:
  mic input and speaker output can operate simultaneously

Conversation Floor Channel:
  determines who is allowed to produce audible speech
```

The agent must always be able to listen, but it should almost never auto-speak. Most agent output should first appear as:

```text
canvas proposal
risk badge
work item draft
“agent requesting floor” indicator
side-panel note
```

Only selected contributions become TTS.

---

# 5. The floor manager

This is the heart of the engine.

## Floor state

```ts
type FloorState =
  | "idle"
  | "human_speaking"
  | "multiple_humans_speaking"
  | "agent_waiting"
  | "agent_speaking"
  | "agent_interrupted"
  | "tool_working"
  | "decision_locking"
  | "incident_priority";
```

## Floor ownership

```ts
type FloorOwner =
  | { type: "human"; participantId: string }
  | { type: "agent"; agentId: string }
  | { type: "facilitator"; id: "palpa" }
  | null;
```

## Core rules

```text
Humans never need permission to speak.
Agents always need permission to speak.
Human speech interrupts agent speech.
Agent floor requests are queued, scored, and surfaced.
High-severity incident events may auto-request the floor.
No agent gets to approve its own proposal.
No voice-only command can approve risky actions.
```

## Agent floor request

```json
{
  "type": "floor.requested",
  "sessionId": "HUD-123",
  "requester": {
    "type": "agent",
    "id": "architecture-reviewer"
  },
  "reason": "The team is about to lock a design, but the C4 impact has not been captured.",
  "severity": "high",
  "suggestedUtterance": "I see one missing gate: this affects the pricing-engine boundary but no C4 change or ADR has been captured.",
  "evidenceRefs": [
    "palpa://session/HUD-123/canvas/node/N-82",
    "palpa://project/current/library/pricing-engine/manifest"
  ],
  "expiresAfterMs": 30000
}
```

The floor manager can respond with:

```text
grant
deny
defer
surface visually only
ask human for permission
convert to canvas card
merge with another agent contribution
```

This prevents agent blabbering.

---

# 6. Barge-in and interruption handling

When Palpa is speaking and a human starts talking:

```text
1. VAD detects human speech.
2. Floor manager sees agent_speaking + human_speech_started.
3. TTS cancellation token fires.
4. Audio output stops quickly.
5. Agent utterance is marked interrupted.
6. ASR prioritizes human utterance.
7. Palpa either resumes later, summarizes briefly, or discards the remaining speech.
```

Event sequence:

```text
agent.speech.started
tts.chunk.playing
human.speech.started
agent.speech.interrupted
tts.cancelled
floor.owner.changed → human
transcript.partial
transcript.final
```

This is non-negotiable. The user experience dies if the agent cannot be interrupted.

---

# 7. ASR design

ASR should be an adapter, not a commitment.

```ts
interface AsrAdapter {
  provider: "openai-realtime" | "faster-whisper" | "whisper-cpp" | "deepgram" | "assemblyai" | "custom";

  startSession(input: {
    sessionId: string;
    participantId: string;
    audioTrackId: string;
    languageHint?: string;
    domainVocabulary?: string[];
    partials: boolean;
    wordTimestamps: boolean;
  }): Promise<AsrSession>;

  pushAudio(frame: AudioFrame): Promise<void>;

  stream(): AsyncIterable<
    | TranscriptPartial
    | TranscriptFinal
    | TranscriptRevision
    | AsrError
  >;

  stop(): Promise<void>;
}
```

## ASR pipeline

```text
Audio frame
  → noise suppression / audio normalization
  → VAD
  → speech segment
  → streaming ASR partial
  → punctuation/casing
  → domain vocabulary correction
  → final utterance
  → optional second-pass correction
  → transcript event
```

The **domain vocabulary** is a Palpa advantage. We can bias/correct ASR with project terms:

```text
Codex
Claude Code
C4
ADR
checkout-service
pricing-engine
DiscountRule
OpenTelemetry
NATS
Kokoro
```

This matters because software meetings are full of weird names.

## Partial, final, and revised transcript events

Do not treat transcript text as immutable.

```ts
type TranscriptEvent =
  | {
      type: "transcript.partial";
      utteranceId: string;
      speakerRef: SpeakerRef;
      text: string;
      confidence: number;
      startMs: number;
      endMs: number;
    }
  | {
      type: "transcript.final";
      utteranceId: string;
      speakerRef: SpeakerRef;
      text: string;
      confidence: number;
      words: WordTiming[];
    }
  | {
      type: "transcript.revised";
      utteranceId: string;
      previousText: string;
      revisedText: string;
      reason: "second_pass_asr" | "domain_correction" | "human_edit";
    };
```

This lets Palpa update summaries and canvas proposals without pretending ASR is perfect.

---

# 8. TTS design with Kokoro

Kokoro should be a **Palpa TTS service**, not embedded directly inside the orchestrator.

```text
Palpa TTS Service
  - text normalization
  - pronunciation dictionary
  - sentence/chunk segmentation
  - Kokoro synthesis
  - audio chunk streaming
  - cancellation
  - voice profile selection
  - cache
```

## TTS request

```json
{
  "type": "tts.requested",
  "sessionId": "HUD-123",
  "utteranceId": "AGENT-UTT-99",
  "voice": "palpa-default",
  "text": "Architecture Reviewer found one risk. The pricing engine owns discount eligibility, so checkout-local validation would duplicate business rules.",
  "priority": "normal",
  "maxDurationMs": 12000,
  "interruptible": true,
  "style": {
    "pace": "normal",
    "tone": "calm",
    "format": "concise"
  }
}
```

## TTS response stream

```ts
type TtsStreamEvent =
  | { type: "tts.started"; utteranceId: string }
  | { type: "tts.audio.chunk"; utteranceId: string; pcm: ArrayBuffer; durationMs: number }
  | { type: "tts.completed"; utteranceId: string }
  | { type: "tts.cancelled"; utteranceId: string; reason: "barge_in" | "policy" | "user_stop" };
```

## Product call on voices

I would **not** give every concrete agent a different voice in MVP.

Use one audible identity:

```text
Palpa Facilitator voice
```

Concrete agents can still be named visually:

```text
Architecture Reviewer found a risk.
Data Model Agent drafted an invariant.
PM Agent created four draft work items.
```

Multiple synthetic voices can become theatrical and cognitively noisy. The canvas should carry agent identity; voice should carry the minimum useful spoken summary.

---

# 9. Multiple human speakers

There are three modes.

## Mode A: remote huddle, separate tracks

This is the easiest and should be MVP.

```text
Participant Alice → audio track A → ASR session A → speaker Alice
Participant Bob   → audio track B → ASR session B → speaker Bob
```

Identity comes from Palpa auth + LiveKit participant identity.

This avoids most diarization complexity.

## Mode B: physical room, shared mic

This needs diarization.

```text
Room mic
  → VAD
  → speaker segmentation
  → speaker embeddings
  → cluster Speaker 1 / Speaker 2 / Speaker 3
  → optional mapping to known humans
```

Use pyannote/Diart here. Diart is specifically framed as realtime speaker diarization, and pyannote is a mature open-source speaker diarization toolkit. ([GitHub][10])

Important: diarization gives **speaker attribution**, not secure identity.

So Palpa should distinguish:

```text
speaker attribution:
  “probably Alice said this”

authentication:
  “Alice approved this action”
```

Voice alone should not approve merges, deployments, production mitigations, or locked architectural decisions.

## Mode C: hybrid huddle

The hardest case:

```text
Alice is in the room and also on laptop mic.
Bob is remote.
Room mic hears Alice and Bob through speakers.
Agent TTS is playing through speakers.
```

For hybrid, the engine needs:

```text
echo cancellation
track priority
duplicate speech suppression
speaker attribution confidence
manual correction in transcript UI
```

For MVP, avoid relying on shared-room diarization for critical workflows.

---

# 10. Event model

Palpa Voice Engine should publish typed events. Raw audio should stay mostly in the media pipeline; the durable event stream should contain speech, floor, transcript, semantic, and action events.

## Base event envelope

```ts
type PalpaVoiceEvent<TPayload> = {
  id: string;
  sessionId: string;
  type: string;
  schemaVersion: number;

  occurredAt: string;
  receivedAt: string;

  producedBy: {
    service: "voice-engine" | "asr" | "tts" | "floor-manager" | "agent-broker" | "huddle-ui";
    instanceId?: string;
  };

  actor?: {
    type: "human" | "agent" | "system";
    id: string;
  };

  correlationId?: string;
  causationId?: string;

  confidence?: number;
  visibility: "internal" | "room" | "audit" | "private-agent-note";

  payload: TPayload;
};
```

## Important event families

```text
huddle.*
  huddle.started
  huddle.ended
  huddle.mode.changed

audio.*
  audio.track.started
  audio.track.ended
  audio.level.changed

speech.*
  speech.started
  speech.ended
  speech.overlap.detected

speaker.*
  speaker.attributed
  speaker.enrolled
  speaker.corrected

transcript.*
  transcript.partial
  transcript.final
  transcript.revised

floor.*
  floor.requested
  floor.granted
  floor.denied
  floor.released
  floor.interrupted

intent.*
  intent.command.detected
  intent.question.detected
  intent.decision_candidate.detected
  intent.agent_mention.detected

agent.*
  agent.invited
  agent.context.delta.sent
  agent.contribution.proposed
  agent.contribution.accepted
  agent.contribution.rejected

canvas.*
  canvas.patch.proposed
  canvas.patch.accepted
  canvas.node.created

work.*
  work_item.draft.proposed
  work_item.created
  gate.required

decision.*
  decision.proposed
  decision.lock_requested
  decision.locked

tts.*
  tts.requested
  tts.started
  tts.chunk.played
  tts.completed
  tts.cancelled
```

This event model makes the voice layer replayable, testable, auditable, and debuggable.

---

# 11. Agent orchestration model

The user-facing voice system should have **one audible supervisor/facilitator**, but that supervisor should route work to concrete agents.

```text
Human voice
  → transcript
  → semantic event
  → Palpa Supervisor
  → Agent Participation Broker
  → concrete agents
      - Architecture Reviewer
      - Data Model Agent
      - PM Agent
      - SRE Agent
      - Claude Code adapter
      - Codex adapter
  → structured contributions
  → floor manager
  → canvas/TTS/work graph
```

Concrete coding agents should not receive raw audio. They should receive:

```text
session summary
current topic
relevant transcript excerpts
canvas state
decision log
work graph context
manifest/C4/schema context
specific task
output schema
tool permissions
```

That matches the Agent Pack idea: Palpa owns roles, skills, permissions, context, and gates; Codex/Claude/future agents are provider runtimes behind adapters. 

## Agent contribution schema

```ts
type AgentContribution =
  | {
      type: "silent";
      reason?: string;
    }
  | {
      type: "floor.request";
      reason: string;
      severity: "low" | "medium" | "high" | "critical";
      suggestedUtterance: string;
      evidenceRefs: string[];
    }
  | {
      type: "speak";
      message: string;
      maxDurationMs: number;
      evidenceRefs: string[];
      requiresHumanDecision: boolean;
    }
  | {
      type: "canvas.patch";
      operations: CanvasOperation[];
      rationale: string;
      evidenceRefs: string[];
    }
  | {
      type: "work_items.draft";
      items: WorkItemDraft[];
      evidenceRefs: string[];
    }
  | {
      type: "risk.raise";
      risk: string;
      severity: "low" | "medium" | "high" | "critical";
      recommendedGate?: string;
      evidenceRefs: string[];
    };
```

Agents should usually return `silent`, `canvas.patch`, `work_items.draft`, or `risk.raise`.

They should return `speak` only when the contribution is important enough to interrupt visual flow.

---

# 12. How the engine communicates with the rest of Palpa

## Outbound from Voice Engine

```text
Voice Engine → Event Bus
  transcript.final
  floor.requested
  agent.contribution.proposed
  canvas.patch.proposed
  work_item.draft.proposed
  decision.proposed
  decision.lock_requested
  audit.voice_command_detected
```

## Inbound to Voice Engine

```text
Palpa Platform → Voice Engine
  huddle.session.created
  canvas.node.selected
  agent.run.completed
  gate.reached
  incident.signal.attached
  work_item.updated
  decision.locked
```

## Palpa Graph writes

Voice should not directly mutate official state for serious actions.

Use this lifecycle:

```text
voice utterance
  → proposed event
  → UI/canvas preview
  → human accept/modify/reject
  → graph mutation
  → audit event
```

Examples:

```text
“Create work items from this”
  → creates draft work items

“Lock this architecture decision”
  → creates lock request
  → requires authenticated human confirmation

“Assign Codex to implement it”
  → creates agent assignment proposal
  → requires work item ready + gates
```

## MCP bridge

The Voice Engine and Agent Supervisor should expose huddle/session resources through Palpa MCP:

```text
palpa://session/current/transcript
palpa://session/current/transcript-summary
palpa://session/current/canvas
palpa://session/current/floor-state
palpa://session/current/decision-log
palpa://project/current/c4
palpa://project/current/work-graph
```

Tools:

```text
palpa.requestFloor()
palpa.proposeCanvasPatch()
palpa.draftWorkItem()
palpa.raiseRisk()
palpa.attachEvidence()
palpa.getCurrentTopic()
palpa.getRelevantManifest()
```

MCP resources and tools are a good fit because they expose structured context and external actions to model clients through standardized server primitives. ([Model Context Protocol][9])

---

# 13. Voice command taxonomy

Not every voice command has the same risk.

## Low-risk commands

Can execute immediately:

```text
“Palpa, summarize the last five minutes.”
“Show the affected components.”
“Zoom into checkout-service.”
“Highlight open questions.”
“Mute yourself.”
“Stop talking.”
```

## Medium-risk commands

Create proposals/drafts:

```text
“Turn this into work items.”
“Draft an ADR.”
“Ask Architecture Agent to review this.”
“Create a risk card.”
“Summarize the competing options.”
```

## High-risk commands

Require explicit confirmation:

```text
“Lock this decision.”
“Assign implementation to Codex.”
“Open a PR.”
“Mark this gate approved.”
“Disable this production feature flag.”
“Trigger rollback.”
```

## Approval commands

Should require non-voice authentication:

```text
passkey
signed-in UI confirmation
MFA
role permission
review gate state
```

Voice can initiate approval, but voice should not be the final trust primitive.

---

# 14. UX behavior

The voice UX should feel like this:

```text
Human:
“Palpa, what are we missing before we lock this?”

Palpa:
“I’ll check architecture, data, test, and release risk.”

Canvas:
Architecture Reviewer: reviewing...
Data Model Agent: reviewing...
Test Strategist: reviewing...

Architecture Reviewer requests floor.

Palpa:
“Architecture Reviewer found one issue: the pricing-engine owns discount eligibility, but the current plan adds checkout-local validation. That needs either reuse of pricing-engine or an ADR.”

Human:
“Good. Create the ADR draft and mark it as required before implementation.”

Palpa:
“Drafted. I also added the architecture gate.”
```

The agent speaks briefly, but the canvas carries the artifact.

---

# 15. MVP scope

Build this in layers.

## MVP 0: headless evented voice room

```text
LiveKit room
one or more humans
Palpa audio participant
ASR partial/final events
Kokoro TTS response
barge-in cancellation
event stream persisted
basic transcript UI
```

Success criterion:

```text
Humans can talk naturally.
Palpa can answer briefly.
Humans can interrupt Palpa.
Everything becomes events.
```

## MVP 1: floor manager + voice commands

```text
wake phrase / direct address
floor states
agent speech budget
stop/resume
summarize
create canvas card
draft work item
```

Success criterion:

```text
Palpa does not blabber.
Voice can safely create draft artifacts.
```

## MVP 2: multi-human speaker support

```text
separate remote tracks
speaker labels
manual speaker correction
overlap detection
shared-room diarization experiment
```

Success criterion:

```text
Transcript attribution is useful enough for meetings, but approvals still require auth.
```

## MVP 3: agent participation broker

```text
supervisor routes to concrete agents
agents request floor
agents produce structured contributions
canvas proposals
work item drafts
risk cards
```

Success criterion:

```text
Agents participate without becoming a chaotic group chat.
```

## MVP 4: Palpa platform integration

```text
Palpa Graph writes
work graph writes
decision log
review gates
Agent Pack execution bridge
MCP resources/tools
```

Success criterion:

```text
A voice huddle can produce locked decisions, draft work, and scoped agent tasks.
```

---

# 16. The hardest risks

## 1. Speaker attribution will be messy

Remote separate tracks solve this. Shared-room diarization should be treated as enhancement, not as the core identity mechanism.

## 2. ASR will mishear software terms

Use Palpa’s graph and repo vocabulary to correct terms. Keep transcript revisions explicit.

## 3. The agent will talk too much

Use hard floor policy:

```text
max agent turns per topic
max spoken seconds per contribution
severity threshold
human interrupt always wins
visual-first contributions
```

## 4. Voice approvals are dangerous

Voice can request. Authenticated UI/passkey confirms.

## 5. End-to-end speech models are tempting but opaque

A pure speech-to-speech agent may feel magical, but Palpa needs typed events, audit, floor control, graph writes, and agent routing. Use realtime speech models as adapters where useful, not as the core architecture.

---

# 17. My recommended initial implementation shape

```text
apps/huddle-web
  LiveKit room UI
  transcript panel
  canvas integration
  floor indicators

services/voice-engine
  audio track subscriber
  VAD
  ASR adapter
  transcript event publisher
  floor manager
  barge-in handler

services/tts-kokoro
  Kokoro synthesis
  pronunciation dictionary
  chunked audio streaming
  cancellation

services/huddle-orchestrator
  session state
  semantic event detection
  agent participation broker
  supervisor routing

services/palpa-events
  event schemas
  event validation
  NATS JetStream subjects

services/palpa-mcp
  huddle resources
  graph resources
  agent tools

services/agent-adapters
  Codex adapter
  Claude adapter
  future runtime adapters
```

Event subjects:

```text
palpa.huddle.<sessionId>.speech
palpa.huddle.<sessionId>.transcript
palpa.huddle.<sessionId>.floor
palpa.huddle.<sessionId>.agent
palpa.huddle.<sessionId>.canvas
palpa.huddle.<sessionId>.decision
palpa.huddle.<sessionId>.tts
```

---

# 18. The crisp design principle

The voice engine should obey this rule:

> **Audio is ephemeral. Events are durable. Decisions are human-governed. Agents are interruptible.**

That gives us the right product.

Voice becomes the natural interface, but Palpa remains Palpa:

```text
typed
evented
auditable
canvas-native
agent-aware
human-governed
provider-neutral
```

My strong recommendation: start with **one Palpa Facilitator voice, LiveKit transport, Kokoro TTS, ASR adapter, strict floor manager, and NATS-backed event stream**. Then plug concrete Claude/Codex agents into the huddle through Agent Packs and MCP only after the human-agent floor mechanics feel excellent.

[1]: https://github.com/livekit/livekit?utm_source=chatgpt.com "LiveKit: Real-time video, audio and data for developers"
[2]: https://docs.nats.io/nats-concepts/jetstream?utm_source=chatgpt.com "JetStream - NATS Docs"
[3]: https://github.com/temporalio/temporal?utm_source=chatgpt.com "temporalio/temporal: Temporal service"
[4]: https://opentelemetry.io/docs/?utm_source=chatgpt.com "Documentation"
[5]: https://developers.openai.com/api/docs/guides/realtime-transcription?utm_source=chatgpt.com "Realtime transcription | OpenAI API"
[6]: https://github.com/snakers4/silero-vad?utm_source=chatgpt.com "Silero VAD: pre-trained enterprise-grade Voice Activity ..."
[7]: https://github.com/pyannote/pyannote-audio?utm_source=chatgpt.com "pyannote speaker diarization toolkit"
[8]: https://github.com/hexgrad/kokoro?utm_source=chatgpt.com "Kokoro"
[9]: https://modelcontextprotocol.io/specification/2025-06-18/server/resources?utm_source=chatgpt.com "Resources"
[10]: https://github.com/juanmc2005/diart?utm_source=chatgpt.com "juanmc2005/diart: A python package to build AI-powered ..."
Created the design spec in canvas: **Palpa Voice-to-Codex POC Design Spec**.

Key corrections baked in:

* **SDK-first Codex integration**, not CLI wrapping.
* **Codex customization remains file/config driven**: `AGENTS.md`, `.codex/skills/*/SKILL.md`, `.codex/agents/*.toml`, `.codex/config.toml`.
* **Palpa owns canonical agent packs**, then compiles them into Codex-native files.
* **Whisper/Kokoro isolated in a Python voice service**.
* **Push-to-talk first**, no WebRTC/WebKit/huddle/canvas in this POC.
* **Mandatory `speak` / `show` response contract** so code/logs are never read aloud.
* **Development phases from skeleton → ASR → TTS → Coordinator → Codex SDK → speak/show → read-only demo → scoped-write demo**.

The Codex assumptions are grounded in current OpenAI docs: Codex reads `AGENTS.md` before work, supports skills via `SKILL.md`, supports project-scoped custom agents under `.codex/agents/`, discovers `.codex`/`AGENTS.md` config by walking up from the working directory, and exposes SDK/app-server/MCP-oriented integration surfaces. ([OpenAI Developers][1])

This also aligns with the broader Palpa direction: Palpa as the human-governed SDLC control plane, and agent packs as provider-neutral operating contracts compiled into Codex/Claude-native artifacts.  

[1]: https://developers.openai.com/codex/guides/agents-md?utm_source=chatgpt.com "Custom instructions with AGENTS.md – Codex"
