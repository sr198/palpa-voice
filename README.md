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

Source-of-truth docs:

- [overall-poc.spec.md](/home/srijan/workdir/projects/palpa-voice/overall-poc.spec.md)
- [session-01.plan.md](/home/srijan/workdir/projects/palpa-voice/session-01.plan.md)
