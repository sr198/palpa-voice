# Palpa Voice Slice 1

This repo is now organized as a small monorepo:

- `apps/web` on `3000`: Next.js App Router voice session UI
- `apps/api` on `3001`: Fastify orchestration service for sessions, turns, replies, and audio routes
- `services/voice` on `8000`: Python voice service for ASR WebSocket traffic and TTS HTTP synthesis

## Developer entrypoints

From the repo root:

- `npm install`
- `npm run dev`
- `npm run start`
- `npm run verify`

Python dependencies live in `services/voice/requirements.txt`.

Install them with:

```bash
pip install -r services/voice/requirements.txt
```

## What `npm run dev` starts

`npm run dev` starts all three local processes:

- `apps/web` via `next dev -p 3000`
- `apps/api` via `node --watch src/server.js` on `3001`
- `services/voice/main.py` on `8000`

`npm run start` starts the same three services in non-watch mode.

## Local runbook

### 1. Install dependencies

```bash
npm install
pip install -r services/voice/requirements.txt
```

### 2. Make sure local Codex is available

Session 02 depends on a local `codex app-server` path behind the API.

At minimum:

- the `codex` CLI must be installed
- Codex must be authenticated on this machine
- the API process must be able to launch `codex app-server`

Useful env vars:

- `CODEX_BINARY`: optional, defaults to `codex`
- `CODEX_CWD`: optional, defaults to the current repo root
- `CODEX_MODEL`: optional model override for Codex turns
- `CODEX_APPROVAL_POLICY`: optional, defaults to `never`
- `CODEX_SANDBOX_MODE`: optional, defaults to `workspace-write`
- `CODEX_NETWORK_ACCESS`: optional, defaults to `true`
- `CODEX_TURN_TIMEOUT_MS`: optional, defaults to `30000`

### 3. Start the stack

```bash
npm run dev
```

### 4. Verify health

Check:

- web: `http://127.0.0.1:3000`
- API health: `http://127.0.0.1:3001/health`
- voice health: `http://127.0.0.1:8000/health`

The API health response includes:

- Codex routing/config state
- gateway/supervisor metadata
- available specialist agents
- discovered skills
- discovered apps

### 5. Run automated verification

```bash
npm run verify
```

This currently runs:

- `npm run test --workspace apps/api`
- `python3 -m unittest discover -s services/voice/tests`

## Session 02 behavior

Current voice-session behavior:

- The browser captures microphone audio and streams it to the API.
- The API acts as the gateway supervisor for the session.
- The supervisor/floor model is explicit:
  - one selected specialist agent handles the current turn
  - the gateway/supervisor manages the floor on the agent side
  - the UI shows which agents are available and who can be called next
- The API binds each specialist agent to a persistent local Codex thread.
- The Python voice service still owns Whisper ASR and Kokoro synthesis behind the same transport boundary.
- The API talks to a local `codex app-server` instance, so inherited Codex skills/apps and repo-local Palpa skills are visible to the app.

## Current reply contract

The API now expects role replies to separate spoken delivery from rendered detail.

Important fields:

- `spoken_text`
- `should_speak`
- `delivery_mode`
- `artifact.text`
- `artifact.files_touched`
- `artifact.commands_run`
- `artifact.tool_activity`
- `artifact.diff_summary`
- `topics`
- `next_agent_suggestions`

This allows the client to:

- read voice-safe replies aloud when appropriate
- render visual-only replies without TTS
- show basic repo-work artifacts without scraping one big blob of text

## Current websocket/runtime events

The browser receives:

- session bootstrap events
- transcript events
- `reply.selected`
- `reply.ready`
- `reply.audio_chunk`
- `reply.audio_end`
- `agent.stage`
- `agent.activity`

The `agent.stage` / `agent.activity` stream is the current bridge from Codex runtime behavior into the browser.

## Voice service behavior

The voice service exposes:

- `GET /health`
- `GET /asr`
- `POST /tts/synthesize`
- `POST /tts/stream`

If local ASR/TTS dependencies are unavailable:

- Whisper falls back to mock transcript behavior
- Kokoro falls back to mock tone synthesis

So the stack can still be exercised even if the full native voice path is not available yet.

## Known Session 02 constraints

- `codex app-server` may not start correctly inside constrained sandboxes; local machine execution works better.
- Live Codex turns can be slower than mock/local fallback replies, so the API enforces a turn timeout.
- The structured artifact contract is in place, but live Codex turns still need better population of fields like:
  - `files_touched`
  - `commands_run`
  - `tool_activity`
  - `diff_summary`

## Suggested manual validation flow

1. Start the stack with `npm run dev`.
2. Open `http://127.0.0.1:3000`.
3. Confirm the floor view shows the supervisor and available specialist agents.
4. Pick a specialist to call next.
5. Speak a short request.
6. Confirm:
   - partial and final transcript events appear
   - the selected specialist is preserved
   - agent stage/activity updates appear
   - spoken replies are read aloud only when `should_speak` is true
   - render-only replies stay visual
   - structured artifact sections populate when available

Source-of-truth docs:

- `overall-poc.spec.md`
- `session-01.plan.md`
- `session-02.plan.md`
