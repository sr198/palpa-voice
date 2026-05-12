# Palpa Voice POC

Lean Stage 0 + 1 implementation for validating:
- text/voice-shaped event ingestion
- event-based collaboration loop
- session object curation
- patch validation and review
- live projection UI

## Run

```bash
npm start
```

Then open `http://localhost:3000`.

## What is implemented

- In-memory `PalpaSession`
- `transcript.final` event ingestion
- Lean conversation curator
- Patch validator with basic actor/path policy
- Auto-apply for low-risk patches
- Human review queue for higher-risk patches
- SSE live UI projection

## Intentionally not implemented yet

- persistence
- real voice/ASR
- Codex adapter
- MCP server
- graph export

## Main files

- `src/contracts.js` — disposable schema helpers and sample event shapes
- `src/policy.js` — lean write authorization and review policy
- `src/runtime.js` — in-memory session runtime and event loop
- `src/curator.js` — heuristic utterance classification + patch generation
- `src/server.js` — HTTP API + SSE + static serving
- `public/index.html` — demo UI
