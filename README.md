# Palpa Voice Slice 1

This repo is now organized as a small monorepo:

- `apps/web` on `3000`: Next.js App Router voice session UI
- `apps/api` on `3001`: Fastify orchestration service for sessions, turns, replies, and audio routes
- `services/voice` on `8000`: Python voice service for ASR WebSocket traffic and TTS HTTP synthesis

Developer entrypoints at the repo root:

- `npm install`
- `npm run dev`
- `npm run start`
- `npm run verify`

Python dependencies live in [services/voice/requirements.txt](/home/srijan/workdir/projects/palpa-voice/services/voice/requirements.txt). Install them with `pip install -r services/voice/requirements.txt`.

Current voice-session behavior:

- The browser captures microphone audio, streams it to the API, and chooses a target specialist agent per turn.
- The API acts as a gateway supervisor, binds the selected agent to a persistent local Codex thread, and returns a voice-aware reply split into `spoken_text` for TTS and `artifact_text` for the UI.
- The Python voice service still owns Whisper ASR and Kokoro synthesis behind the same transport boundary.
- The API talks to a local `codex app-server` instance, so inherited Codex skills/apps and repo-local Palpa skills are visible to the app.

Codex app-server environment:

- `CODEX_BINARY`: optional, defaults to `codex`
- `CODEX_CWD`: optional, defaults to the current repo root
- `CODEX_MODEL`: optional model override for Codex turns
- `CODEX_APPROVAL_POLICY`: optional, defaults to `never`
- `CODEX_SANDBOX_MODE`: optional, defaults to `workspace-write`
- `CODEX_NETWORK_ACCESS`: optional, defaults to `true`
- `CODEX_TURN_TIMEOUT_MS`: optional, defaults to `30000`

Source-of-truth docs:

- [overall-poc.spec.md](/home/srijan/workdir/projects/palpa-voice/overall-poc.spec.md)
- [session-01.plan.md](/home/srijan/workdir/projects/palpa-voice/session-01.plan.md)
