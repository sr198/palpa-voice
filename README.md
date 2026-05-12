# Palpa Voice POC

Lean POC for validating:
- voice-first communication flows
- event-based collaboration
- session object curation
- patch validation and review
- bounded context handoff to Codex agents
- live projection UI

The contracts and shapes in this repo are intentionally lean and disposable. The goal is to validate the interaction loop, not lock a permanent architecture.

## Run

```bash
npm start
```

Then open `http://localhost:3000`.

## Current scope

### Stage 0 — Lean foundations
Implemented:
- in-memory `PalpaSession`
- disposable contract helpers in `src/contracts.js`
- lean actor/path policy in `src/policy.js`
- sample fixtures in `fixtures/`
- minimal server and repo scaffold

### Stage 1 — Text huddle to live session object
Implemented:
- text input path shaped like `transcript.final`
- lean conversation curator in `src/curator.js`
- patch proposal → validator → session apply flow
- low-risk auto-apply and review queue for higher-risk patches
- live UI for transcript, session object, and patch feed

### Stage 2 — Lean governance and review
Implemented:
- explicit pending patch review flow
- approve/reject controls in UI
- audit log of proposed/applied/reviewed/rejected patches
- basic authorization and validation rules

Current behavior:
- material claims require `evidenceRefs`
- curator cannot write outside allowed session paths
- decision-like updates go to review instead of auto-applying

### Stage 3 — Context pack + Codex handoff lite
Implemented:
- bounded Codex context pack builder in `src/context-builder.js`
- context pack preview in UI
- agent run lifecycle stored in session state
- minimal Codex handoff endpoint: `POST /api/agents/codex/run`
- local simulated Codex worker in `src/codex-sim.js`
- governed Codex contribution path back into pending session patches

Current behavior:
- Codex sees only a bounded context pack, not the full transcript as default context
- Codex run creates an `agentRun` record
- Codex proposals are constrained by policy and show up as reviewable patches
- current simulated Codex output is limited to `outputs.codexFindings`

## What is intentionally not implemented yet
- persistence
- real voice/ASR
- real Codex SDK adapter
- MCP server/tooling
- graph export
- production auth/multi-user/session durability

## Main files

- `src/contracts.js` — disposable schema helpers and sample event shapes
- `src/policy.js` — lean write authorization and review policy
- `src/curator.js` — heuristic utterance classification + patch generation
- `src/context-builder.js` — bounded Codex context pack generation
- `src/codex-sim.js` — local simulated Codex worker for handoff validation
- `src/runtime.js` — in-memory session runtime and event loop
- `src/server.js` — HTTP API + SSE + static serving
- `public/index.html` — demo UI

## Demo flows you can review

### Flow 1: conversation curation
1. Enter text in the UI
2. It is ingested as `transcript.final`
3. The curator proposes a patch
4. The validator either auto-applies it or queues it for review
5. The session object updates live

### Flow 2: Codex handoff lite
1. Add a few conversation messages
2. Click **Run simulated Codex**
3. The runtime builds a bounded Codex context pack
4. A Codex agent run is created in session state
5. Simulated Codex returns a governed proposed patch
6. The patch appears in the review queue

## Review focus

If you are reviewing this repo through the README first, the main thing to verify is this loop:

```text
conversation event
  -> curated session state
  -> bounded Codex context pack
  -> governed agent contribution
  -> reviewable session patch
```

That is the core POC currently implemented.
