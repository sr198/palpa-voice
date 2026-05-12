# Session 01 Plan

## Goal

Deliver the first visible voice collaboration loop:

```text
user voice input
  -> transcription
  -> mock agentic interaction
  -> mock canvas output
  -> TTS response
```

At the end of this session, one person should be able to open the app, speak once, and watch the system complete one full conversational turn.

## Why this is the right first slice

This is the smallest vertical slice that validates the product direction without rebuilding the old text-first prototype.

It proves:

- voice is the primary input
- events are the internal backbone
- an agent can participate in the loop
- the system can create a visible artifact
- Palpa can speak back

It does not try to prove multi-user rooms, real Codex execution, LiveKit, or full floor arbitration yet.

## MVP definition

The MVP for Session 01 is successful if this exact flow works:

1. User clicks `Start`.
2. User speaks a short request such as:
   `Palpa, ask the architecture reviewer to summarize the concern.`
3. The UI shows live listening state.
4. A transcript appears.
5. The app emits visible typed events in order.
6. A mock agent is selected and produces a structured mock contribution.
7. The canvas/dashboard updates with that contribution.
8. Palpa speaks a short facilitator response over TTS.
9. The turn ends in a clean idle state.

## Scope

### In scope

- single local browser session
- one human participant
- browser microphone input
- speech-to-text for a single utterance
- simple event log in the UI
- mock supervisor and mock agent router
- one or two mock agent personas
- canvas/dashboard card creation
- browser TTS response
- visible turn lifecycle state

### Out of scope

- LiveKit
- multi-human participants
- real Codex or Claude adapters
- real MCP
- real work graph writes
- durable persistence
- interruption during TTS
- shared-room diarization
- production auth

## Product behavior

### User experience

The first demo should feel like this:

1. User opens the app.
2. User sees a large voice control and a simple dashboard.
3. User presses record and speaks.
4. The app shows:
   - `listening`
   - `transcribing`
   - `routing to agent`
   - `agent responded`
   - `speaking`
   - `idle`
5. A mock agent result appears as a card on the canvas.
6. Palpa speaks a concise summary of what happened.

### Suggested example prompts

- `Palpa, ask the architecture reviewer for concerns.`
- `Palpa, create a draft work item for this idea.`
- `Palpa, summarize the next step.`

## Technical approach

Build the smallest possible local stack:

### Frontend

- single page app in plain HTML, CSS, and browser JavaScript
- microphone button and status indicator
- transcript panel
- event timeline
- canvas/dashboard panel
- agent activity panel

### Voice input

Prefer the browser Web Speech path first if it is available.

Why:

- fastest way to validate the loop
- no backend audio transport required for Session 01
- keeps the session focused on user-visible behavior

Fallback:

- if browser speech recognition is unavailable, allow a temporary typed-input fallback behind a debug toggle, but the main path must remain voice-first

### Agent behavior

Use a mock supervisor and mock agent broker in the browser or a very thin local server path.

Minimal behavior:

- inspect transcript text
- detect one simple intent
- route to one mock agent
- return a structured response object

Example mock response:

```json
{
  "agent": "architecture-reviewer",
  "type": "risk.raise",
  "title": "Boundary unclear",
  "summary": "Checkout and pricing ownership needs clarification before implementation.",
  "spokenReply": "Architecture Reviewer found one issue. Checkout and pricing ownership should be clarified before implementation."
}
```

### Voice output

Use browser speech synthesis for the first slice.

Why:

- fastest visible TTS
- zero infrastructure overhead
- good enough to validate turn completion

Kokoro or a dedicated TTS service can replace this in a later slice.

## Event model for this slice

Keep the event model small but explicit.

Required event types:

- `speech.started`
- `speech.ended`
- `transcript.final`
- `intent.detected`
- `agent.requested`
- `agent.responded`
- `canvas.card.created`
- `tts.started`
- `tts.completed`
- `turn.completed`

Each event should show in the UI in timestamp order.

## UI shape

The first slice UI should have four visible zones:

1. Voice control
   - record button
   - status badge
   - current turn state

2. Transcript
   - latest recognized utterance

3. Event timeline
   - ordered event feed for the current turn

4. Canvas/dashboard
   - one or more mock output cards
   - last speaking agent
   - last spoken facilitator response

## Delivery checklist

- microphone access works
- one spoken utterance becomes transcript text
- transcript becomes a typed event
- one mock intent is recognized
- one mock agent is selected
- one structured output card is rendered
- one TTS response is spoken
- UI resets back to idle after completion

## Failure handling for this slice

- if mic permission is denied, show a clear blocked state
- if transcription fails, show an error state and allow retry
- if no intent is recognized, route to a generic facilitator reply
- if TTS fails, still render the response visually

## Visible MVP criteria

This session is done only if a reviewer can:

1. open the app,
2. speak one request,
3. see transcript and events,
4. see a mock artifact appear,
5. hear Palpa speak back,
6. repeat the flow without refreshing the app.

## What comes next after Session 01

The next session should extend this exact loop by one visible capability, not rewrite it.

Good Session 02 options:

- add interruption and TTS cancel
- add one more mock agent and visible floor request behavior
- move mock agent routing behind a real local adapter boundary
- add partial transcripts and turn state improvements

The rule stays the same:

> every session must end with a visible MVP that extends the live conversation loop.
