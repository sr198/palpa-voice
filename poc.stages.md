# Palpa Voice POC — Staged Build Plan

This plan converts `poc.spec.md` into an execution roadmap we can build **one stage per session**.

Core rule for the entire POC:

> Raw transcript is evidence. The session object is working memory. Context packs are the only default agent context.

---

## Build strategy

We will build in vertical slices, not layers.
Each stage must end with:

1. a visible demo,
2. bounded architecture,
3. explicit failure handling,
4. artifacts we can keep for the next stage.

---

# Stage 0 — Foundations and contracts

## Goal
Lock the core contracts before UI/agent work starts so later stages do not drift.

## What must exist
- Canonical `PalpaSession` schema
- Canonical `SessionPatchProposal` schema
- Actor/path authorization policy
- Event types for `transcript.final`, `session.patch.proposed`, `session.patch.applied`, `agent.run.*`
- Risk classification for patches: `low | medium | high`
- Decision states: `candidate | confirmed | locked | rejected`
- Folder/service skeleton for the POC

## Architecture for this stage
```text
contracts/
  session.schema.ts
  patch.schema.ts
  events.schema.ts
  policy.ts

apps/
  huddle-web/
services/
  session-runtime/
  conversation-curator/
  context-builder/
  agent-supervisor/
  codex-adapter/
  palpa-mcp-session/
```

## Success criteria
- We can instantiate an empty session and validate it
- We can validate/reject sample patches by actor and path
- We have sample fixtures for good/bad transcript and patch events
- We have a documented “allowed writes by producer” table

## Failure scenarios handled here
- Invalid patch shape
- Unauthorized path mutation
- Missing `evidenceRefs` for material claims
- Decision locking by non-human actor
- Session schema drift between services

## Why this stage comes first
If contracts are soft, every later stage becomes rewrite-heavy.

---

# Stage 1 — Text huddle → live session object

## Goal
Prove the core Palpa loop without voice or Codex:

```text
typed conversation → transcript events → curator patch → validator → session object → live UI
```

## What must exist
- Minimal web UI with 3 panes:
  - live conversation
  - curated session object
  - proposed/applied patch feed
- `session-runtime` service
  - session store
  - patch validator
  - patch log
  - websocket or SSE projection
- `conversation-curator` service
  - consumes `transcript.final`
  - classifies utterances
  - emits `session.patch.proposed`
- Text input path that mimics future voice event shape

## Architecture for this stage
```text
User text input
  -> transcript.final event
  -> conversation-curator
  -> session.patch.proposed
  -> session-runtime validator
  -> session store
  -> UI live projection
```

## Data boundaries
- Full transcript stored separately from curated session state
- Curator cannot write directly to session store
- UI renders accepted and pending patches separately

## Success criteria
- A typed conversation creates a durable session object live
- The session fills `rollingSummary`, `activeTopic`, `openQuestions`, `risks`, `decision candidates`
- Low-risk patches auto-apply
- High-risk patches are visible and pending human review

## Failure scenarios handled here
- Human rambles: session stays compact
- Human self-corrects: prior candidate gets revised, not duplicated
- Two conflicting statements: becomes `openQuestion`, not false decision
- Duplicate patches from curator: deduped or rejected
- Curator confidence too low: patch marked for review

## Why this stage matters
This validates the product thesis before any agent integration complexity.

---

# Stage 2 — Session governance and review controls

## Goal
Make the session trustworthy before bringing in external agents.

## What must exist
- Human approval/reject controls in UI
- Patch diff viewer
- Patch audit log with evidence refs
- Policy engine with actor-based write scopes
- Patch status model:
  - `accepted`
  - `needs_human_review`
  - `rejected`
- Basic session lifecycle state handling

## Architecture for this stage
```text
Patch proposal
  -> schema validation
  -> authorization policy
  -> risk policy
  -> accepted / review / rejected
  -> audit log
  -> session projection update
```

## Additional rules introduced here
- Material output requires evidence refs
- Only humans can lock decisions
- Curator can create candidate artifacts, not official outcomes
- Supervisor owns `agentRuns` and `contextPacks`

## Success criteria
- Reviewer can approve/reject pending patches from UI
- Audit log explains why a patch was rejected
- Session projection is reproducible from accepted patch history

## Failure scenarios handled here
- Patch without evidence
- Conflicting patch against locked decision
- Curator attempts unauthorized write
- Stale patch against newer session version
- Human review race conditions

## Why this stage matters
Without governance, adding Codex would create a flashy but unsafe demo.

---

# Stage 3 — Context builder and anti-rot memory model

## Goal
Prove that Palpa can create bounded, role-scoped context packs instead of dumping transcript history into agents.

## What must exist
- `context-builder` service
- Context pack schema
- Topic-based evidence excerpt selection
- Context budget rules
- Pack invalidation/rebuild rules when session changes
- UI view for “what Codex will see”

## Architecture for this stage
```text
Session object + bounded transcript excerpts
  -> context-builder
  -> role-scoped context pack
  -> stored pack ref
  -> UI preview
```

## Context layers enforced
- L0 raw transcript = evidence only
- L1 utterance metadata = event history
- L2 session object = working memory
- L3 context pack = scoped agent context

## Success criteria
- Codex preview pack contains only relevant summary, decisions, questions, risks, work items, and bounded excerpts
- Unrelated chatter is excluded
- A session update invalidates only affected packs

## Failure scenarios handled here
- Context pack exceeds size budget
- Irrelevant transcript leaks into pack
- Missing evidence link for important claim
- Old context pack served after session changed
- Agent receives contradictory decisions without status markers

## Why this stage matters
This is the core differentiator vs. “long transcript into model.”

---

# Stage 4 — Agent supervisor + Codex adapter (read-only integration first)

## Goal
Bring Codex into the loop safely, but initially as a read-only external participant that returns structured output.

## What must exist
- `agent-supervisor` service
- `codex-adapter` service
- AgentRun model and lifecycle
- Workspace preparation for a run:
  - `session.snapshot.json`
  - `context-pack.codex.md`
  - `task.md`
  - generated `AGENTS.md`
- Structured result ingestion path

## Architecture for this stage
```text
Human asks Codex
  -> supervisor creates AgentRun
  -> context-builder creates Codex pack
  -> codex-adapter prepares governed workspace
  -> Codex run executes
  -> adapter parses structured result
  -> result shown in UI as findings + proposed patch draft
```

## Constraints in this stage
- No MCP writeback yet
- No repo mutation yet
- Codex output is treated as proposed contribution only

## Success criteria
- A user can ask Codex a session-scoped design question
- Codex gets only the context pack, not the whole transcript
- Codex result appears in Agent Runs pane with structured findings
- Proposed changes can be converted into reviewable patches

## Failure scenarios handled here
- Codex returns prose instead of structure
- Codex exceeds scope of task
- Codex suggests state mutations it is not authorized to make
- Agent run times out or fails
- Context pack missing critical artifact for the requested task

## Why this stage matters
It proves external agent participation without yet trusting tool writeback.

---

# Stage 5 — MCP session server + controlled agent writeback

## Goal
Allow Codex to participate through governed MCP resources/tools and update the session via validated patches.

## What must exist
- `palpa-mcp-session` server
- MCP resources:
  - `palpa://session/current`
  - `palpa://session/current/context-pack/codex`
  - focused session subresources as needed
- MCP tools:
  - `palpa_session_propose_patch`
  - `palpa_session_add_agent_finding`
  - `palpa_session_draft_work_item`
- Tool invocation audit trail
- Agent-visible approval feedback

## Architecture for this stage
```text
Codex runtime
  -> reads session MCP resources
  -> calls controlled session MCP tools
  -> validator enforces policy
  -> session updates or review queue
  -> UI shows live agent contribution
```

## Security/governance rules
- Codex can write only draft/candidate paths
- No graph writes
- No locked decisions
- No hidden writes outside validator
- Tool calls surface visibly in UI

## Success criteria
- Codex can read live session state through MCP
- Codex can propose a patch via MCP and it appears in UI live
- Unauthorized tool write is rejected with a clear reason

## Failure scenarios handled here
- Codex omits evidence refs
- Codex tries forbidden path
- Duplicate tool retries create duplicate artifacts
- MCP server unavailable mid-run
- Tool result accepted but session projection fails to refresh

## Why this stage matters
This proves the Palpa agent contract, not just a one-off adapter hack.

---

# Stage 6 — Voice input/output on top of proven session loop

## Goal
Add voice as an interface layer after the session loop and governance model already work.

## What must exist
- Input engine supporting ASR events mapped to `transcript.final`
- Partial/final transcript handling
- Speaker attribution placeholder support
- Optional TTS for selected system responses
- Floor-request UX for agent interruptions later

## Architecture for this stage
```text
Audio input
  -> ASR
  -> transcript.partial / transcript.final
  -> same curator + validator + session flow as text

Session events
  -> selected updates
  -> TTS / visual notifications
```

## Constraints in this stage
- Voice does not change core state semantics
- Session loop remains identical to text mode
- If ASR fails, user can fall back to text immediately

## Success criteria
- Voice utterances enter the exact same event pipeline as text
- Curated session quality remains stable under spoken input
- Voice errors do not corrupt the session object

## Failure scenarios handled here
- ASR mishears key requirement
- Partial transcript creates premature patch
- Speaker confusion causes wrong attribution
- Long pause / reconnect / dropped mic
- TTS interrupts active human discussion

## Why this stage matters
Voice should enhance the proven system, not become the source of architectural ambiguity.

---

# Stage 7 — Export simulation and large-platform readiness checks

## Goal
Show how this POC becomes the front door to the broader Palpa platform without pretending full graph infrastructure already exists.

## What must exist
- “Would export” projection from accepted session artifacts
- Mapping rules from session outputs to future graph targets:
  - work graph
  - decision graph
  - architecture graph
- Readiness checklist for scaling beyond POC

## Architecture for this stage
```text
Accepted session artifacts
  -> export mapper
  -> wouldExport payload
  -> UI/export preview
```

## Success criteria
- Accepted work items, decisions, and architecture notes map cleanly to future graph writes
- The POC can demonstrate governance boundaries between draft and official state

## Failure scenarios handled here
- Ambiguous artifact ownership
- Candidate items exported as official by mistake
- Missing provenance for exportable artifacts
- Session object too generic to map to future graph model

## Why this stage matters
It closes the loop from “conversation artifact” to “platform control plane.”

---

# Recommended implementation order

## Session 1
Stage 0 + Stage 1 if velocity allows, otherwise Stage 0 only.

## Session 2
Finish Stage 1 and Stage 2.

## Session 3
Stage 3.

## Session 4
Stage 4.

## Session 5
Stage 5.

## Session 6
Stage 6.

## Session 7
Stage 7 + cleanup.

---

# Architecture decisions to lock now

1. **Text-first before voice**
   - Voice enters the same transcript event model later.

2. **Session object is the POC system of record**
   - Not the raw transcript.

3. **All writes go through patch validation**
   - No direct session mutation by curator or Codex.

4. **Context packs are role-scoped, evidence-linked, and bounded**
   - No transcript dump by default.

5. **Codex joins as a governed runtime, not as platform owner**
   - Palpa owns contracts, policy, and final state.

6. **Graph writes are explicitly deferred**
   - POC exports simulate future integration.

---

# Best first build target

If we are building one stage at a time in one session, the best starting point is:

> **Stage 0 — Foundations and contracts**

because it reduces rework across every downstream service and lets us move fast safely in Stage 1.

Immediate next deliverables for Stage 0:
- repo structure
- shared schemas
- validator policy
- sample fixtures
- initial README for running the POC services
