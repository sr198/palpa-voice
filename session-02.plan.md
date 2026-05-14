# Session 02 Plan

## Objective

Validate a real end-to-end Palpa voice loop against local Codex:

`human speech -> Whisper transcript -> Codex role thread -> spoken reply for TTS + artifact output for UI -> visible agent execution state`

This session moves beyond mock/local placeholder role replies and proves that the voice platform can drive Codex directly against this repo.

## Progress In This Session

### Completed

- Replaced the abandoned OpenAI API / OpenAI Agents SDK branch with a local `codex app-server` integration path in the API.
- Added a long-lived JSON-RPC Codex client in `apps/api/src/codex-client.js`.
- Added a Codex workspace adapter in `apps/api/src/agents.js` that:
  - discovers Codex auth state
  - discovers inherited/system/plugin skills
  - discovers available Codex apps/connectors
  - injects repo-local Palpa skills explicitly
  - keeps one Codex thread per selected role
  - constrains final role output to:
    - `spoken_text`
    - `artifact_text`
    - `topics`
- Extended `SessionStore` so each voice session now holds session-scoped Codex state:
  - `threadsByAgentId`
  - `skillsByName`
  - `appsById`
- Extended `session.started` so the browser receives:
  - agent roster
  - Codex auth/config status
  - discovered skills
  - discovered apps
  - discovery warnings
- Extended reply payloads so the browser receives:
  - `provider`
  - `mode`
  - `thread_id`
  - `skills_used`
- Added live agent runtime websocket events in the API:
  - `agent.stage`
  - `agent.activity`
- Mapped Codex runtime notifications into Palpa-oriented execution stages and activity summaries.
- Extended the browser client to render:
  - current agent stage
  - recent runtime activity
  - Codex turn metadata during a live turn
- Expanded the role reply contract beyond plain artifact text so replies now carry:
  - delivery metadata (`should_speak`, `delivery_mode`)
  - structured artifact fields
  - next-agent suggestions for supervisor-managed floor flow
- Simplified the browser UI around:
  - supervisor/floor visibility
  - available specialists
  - next-call choices
  - spoken-vs-rendered response handling
- Added repo-local Codex skills for dogfooding:
  - `.agents/skills/voice-mode`
  - `.agents/skills/architect-voice`
  - `.agents/skills/orchestrator-voice`
  - `.agents/skills/voice-lead`
  - `.agents/skills/frontend-voice`
- Verified inherited Codex skills plus repo-local Palpa skills are visible together in app bootstrap.
- Verified one live Codex turn outside the sandbox against this repo:
  - Codex returned structured `spoken_text`
  - Codex returned structured `artifact_text`
  - Codex used repo-local skills
  - Codex persisted a real thread id

### Known Constraints

- `codex app-server` cannot start inside the current Codex sandbox because it needs writable access to Codex home/config state.
- The integration works when run outside the sandbox on this machine.
- The live Codex turn can be materially slower than a mock reply, so a 30 second turn timeout is now enforced before fallback.
- The current artifact handling is text-only. Codex can perform repo work, but the browser does not yet render structured work artifacts such as file changes, command activity, or diff summaries.

## Scope

### In scope

- End-to-end client validation with real microphone input and a real Codex-backed role turn
- Spoken reply quality suitable for TTS conversation
- Artifact output that is useful for the client to render separately from speech
- Codex agent execution against this repo
- Explicit agent execution state surfaced through the API and visible in the browser

### Out of scope

- Provider-neutral orchestration layer
- Multi-provider runtime abstraction
- Durable persistence across server restarts
- Full multi-agent floor control / arbitration
- Human approval UX for Codex tool approval flows

## What Still Needs To Be Done

### 1. End-to-end browser validation

- Run the full stack locally with:
  - browser client
  - API
  - voice service
  - local Codex app-server access available to the API process
- Speak into the client and confirm:
  - transcript is correct enough for routing
  - selected role is respected
  - spoken reply is short and natural when read by Kokoro
  - artifact output is meaningful and distinct from spoken output

### 2. Real artifact work contract

- Keep evolving the structured artifact payload now that the API/browser contract includes:
  - `artifact.text`
  - `artifact.files_touched`
  - `artifact.commands_run`
  - `artifact.tool_activity`
  - `artifact.diff_summary`
- Keep `spoken_text` optimized for human conversation and separate from execution evidence.
- Improve how reliably live Codex turns populate those structured artifact fields, not just fallback/default values.

### 3. Agent execution state management

- Extend the current stage model as needed. The API now emits explicit `agent.stage` updates and basic runtime activity.
- Continue refining the stage mapping around states such as:
  - `bootstrapping`
  - `discovering_skills`
  - `routing`
  - `thinking`
  - `tool_running`
  - `editing`
  - `reply_ready`
  - `failed`
- Preserve the current voice turn lifecycle while refining the nested agent execution lifecycle.

### 4. Better handling of Codex runtime notifications

- Expand the current notification mapping so it captures and exposes richer payloads for:
  - `item/agentMessage/delta`
  - `item/commandExecution/outputDelta`
  - `item/fileChange/patchUpdated`
  - `item/mcpToolCall/progress`
  - `turn/plan/updated`
  - `thread/status/changed`
- Convert those into UI-friendly events instead of only waiting for final turn completion.

### 5. Tool and artifact rendering in the client

- Keep the client simple, but continue improving:
  - current floor/supervisor visibility
  - next-call affordances
  - files changed / diff summary rendering
  - commands/tool activity rendering
  - spoken reply separation from rendered artifacts

## Proposed Implementation Order

1. Run the full stack locally and verify one real voice-to-Codex-to-TTS turn from the browser.
2. Add API event mapping for live Codex execution state and tool activity.
3. Extend the browser to render agent execution state and artifact panels.
4. Expand the Codex structured output contract to include execution/artifact metadata.
5. Re-run end-to-end testing with real repo work, not just advisory replies.

## Success Criteria

1. A human can speak to the browser client and trigger a real Codex role turn against this repo.
2. Codex responds with both:
   - concise `spoken_text` for Kokoro
   - richer artifact output for the UI
3. The browser shows which role/thread handled the request.
4. The browser shows what Codex is doing while the turn is in progress.
5. At least one turn demonstrates actual repo-aware work, not just high-level commentary.

## Next Step After Session 02

If this session is validated successfully:

1. Persist agent session/thread state beyond process memory.
2. Add approval and interruption handling for commands, file edits, and MCP elicitation.
3. Introduce supervisor-level routing rules instead of explicit user-selected routing only.
4. Start shaping the provider/runtime adapter layer once the direct Codex path is proven stable.
