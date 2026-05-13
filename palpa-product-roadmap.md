# Palpa Product Roadmap

## 1. North Star

Palpa is an AI-native software engineering platform for human-agent software teams.

Humans use visual and voice huddles to design, debate, review, and approve software. Codex, Claude, and similar agents join as governed role-scoped collaborators. Palpa connects product intent, architecture, manifests, schema, work items, agent runs, PRs, review gates, runtime signals, incidents, and postmortems into one typed project graph.

Palpa is not a coding agent. It is the control plane for human-agent software delivery.

## 2. Core Product Principles

1. **Humans own decisions.** Product, architecture, quality, security, release, and production risk decisions are made by humans.
2. **Agents operate through contracts.** Agents have explicit roles, skills, permissions, context, output schemas, and gates.
3. **Capability is the primary primitive.** Tickets are execution units; capabilities represent product reality.
4. **The graph is the product memory.** Product intent, C4 architecture, manifests, schema, work, code, tests, releases, and incidents must be traceable.
5. **Manifests are mandatory.** Apps, services, libraries, and product schemas expose agent-readable metadata.
6. **C4 stays live.** App C4 models and library C4 fragments become inspectable, linked architecture context.
7. **Voice is infrastructure.** ASR/TTS sit between humans and agents. Agents receive structured transcript events, not raw audio by default.
8. **External agents are the runtime.** Codex, Claude, and future agents are used through Palpa-defined roles, skills, plugins, and adapters.
9. **No chatbot-first product.** Palpa must first build graph, gates, manifests, agent contracts, and evidence trail.

## 3. End-State Product Modules

### Palpa Studio

The visual and voice collaboration surface.

Includes:

- Huddle room
- Typed visual canvas
- Voice gateway integration
- Decision capture
- Capability map
- Architecture explorer
- Review center
- Incident room

### Palpa Graph

The typed project graph.

Includes:

- Product graph
- Architecture graph
- Code/artifact graph
- Data/schema graph
- Work graph
- Runtime graph
- Decision graph

### Palpa Work

The unified project management system for humans and agents.

Includes:

- Roadmap
- Capability epics
- Work items
- Agent assignments
- Human assignments
- Timelines
- Dependencies
- Review gates
- Evidence links

### Palpa Agents

The external-agent orchestration layer.

Includes:

- Agent pack schema
- Role registry
- Skill registry
- Provider adapters
- MCP server
- Context pack builder
- Agent run ledger
- Floor policy
- Output validation

### Palpa Assurance

The governance and quality layer.

Includes:

- Architecture gates
- Data model gates
- Security gates
- Reliability gates
- Implementation gates
- Release gates
- Audit log
- Evidence validation

### Palpa Operate

The production and maintenance layer.

Includes:

- Incident room
- Affected capability mapping
- Recent change correlation
- Hypothesis board
- Mitigation decision capture
- Runbook integration
- Postmortems
- Follow-up work generation

## 4. Roadmap Overview

Palpa should be built in capability slices, not disconnected features.

The three long-term product loops are:

1. **Huddle → locked plan → executable work graph**
2. **Work item → external agent execution → PR → human review gate**
3. **Alert/incident → system graph → hypothesis → mitigation/postmortem**

The MVP should prove the first two loops and include a skeleton of the third.

## 5. Release Phases

### R0 — Palpa-Lite Operating System

Goal: create the repo-level operating artifacts for building Palpa with Palpa-like discipline.

Deliverables:

- North Star document
- Capability ledger
- Scenario acceptance tests
- Initial Palpa C4 model
- Initial app/service/library manifests
- Agent role definitions
- Skill definitions
- Gate definitions
- Decision ledger
- High-level roadmap

Success criteria:

- The team has a shared product direction.
- Every future work item can link to a capability, scenario, gate, and decision.

### R1 — Palpa Kernel

Goal: build the typed graph and manifest compiler.

Deliverables:

- Graph node/edge/event model
- Artifact registry
- App manifest parser
- Library manifest parser
- Product schema manifest parser
- C4 importer
- Manifest validation report
- Basic graph API

Success criteria:

- Palpa can ingest its own repo manifests.
- Palpa can show apps, services, libraries, capabilities, C4 fragments, and missing metadata.

### R2 — Huddle-to-Work Graph

Goal: humans can discuss a feature and turn it into typed product/work artifacts.

Deliverables:

- Huddle session model
- Transcript import/capture
- Typed canvas nodes
- Capability cards
- Feature cards
- Risk cards
- Decision capture
- Work item drafts
- Gate drafts
- Human lock action

Success criteria:

- A human-created feature brief can become typed decisions, risks, work items, and gates.

### R3 — Agent-in-the-Room

Goal: Codex/Claude-style agents can contribute to huddles as governed collaborators.

Deliverables:

- Agent pack schema
- Skill schema
- Agent registry
- Huddle floor policy
- Agent contribution schema
- Context pack builder
- One external provider adapter
- Minimal Palpa MCP server

Success criteria:

- An Architecture Agent can inspect huddle context, request the floor, raise a risk, propose a decision, and draft work items.
- Humans can accept, reject, or lock the contribution.

### R4 — Work-to-PR Execution

Goal: a locked work item can be executed by an external coding agent with scoped context and human review.

Deliverables:

- Work pack generator
- Scoped repo/worktree execution workspace
- Allowed paths policy
- Agent task launcher
- Evidence collector
- PR linker
- Review gate screen

Success criteria:

- A locked work item can be handed to Codex/Claude.
- The agent produces a PR with evidence.
- The human reviewer approves or rejects through Palpa.

### R5 — Incident Room Skeleton

Goal: prove Palpa also matters after deployment.

Deliverables:

- Incident object
- Affected capability linking
- Affected architecture view
- Recent PR/deployment view
- Hypothesis board
- Mitigation decision capture
- Timeline
- Postmortem draft
- Follow-up work item generation

Success criteria:

- Given a production issue, Palpa can open an incident room, show affected capability/architecture nodes, capture hypotheses and decisions, and draft follow-up work.

### R6 — Governance and Hardening

Goal: make the MVP trustworthy.

Deliverables:

- Audit log
- Permission model
- Gate enforcement
- Agent run ledger
- Evidence validation
- Provider abstraction hardening
- Failure handling
- Review history

Success criteria:

- No agent-originated work becomes official product/work/code state without human approval, evidence, and audit trail.

## 6. Capability Maturity Roadmap

| Capability | R0 | R1 | R2 | R3 | R4 | R5 | R6 |
|---|---|---|---|---|---|---|---|
| Capability graph | Manual ledger | Graph nodes | Huddle-linked | Agent-readable | Work-linked | Incident-linked | Governed |
| C4 integration | Repo files | Ingested | Impact cards | Agent analysis | PR evidence | Incident topology | Drift checks |
| Manifest compiler | Schema drafts | Parser/validator | Huddle impact | Agent-readable | Work-pack input | Incident context | Enforced |
| Huddles | Scenario only | Session node | Typed huddle | Agent participation | Work assignment | Incident huddle | Audited |
| Visual canvas | Manual sketch | N/A | Typed canvas | Agent patches | Review surface | Incident board | Collaborative |
| Agent roles | YAML drafts | Registry nodes | Assignable | Live huddle agents | Execution agents | Incident agents | Permissioned |
| Skills/plugins | Markdown drafts | Stored artifacts | N/A | Provider compiled | Used in tasks | Used in incident | Versioned |
| Work graph | Manual roadmap | Work nodes | Draft work items | Agent proposals | Agent execution | Follow-up actions | Gate enforced |
| Review gates | YAML drafts | Gate nodes | Human lock | Agent respects gates | PR review gates | Mitigation gates | Enforced |
| Voice | Not used | Not used | Transcript input | Agent response TTS | N/A | Incident commands | Hardened later |
| Incident room | Scenario only | Runtime node type | N/A | N/A | N/A | Read-only room | Governed |

## 7. MVP Boundary

The MVP must include:

- Typed project graph
- Manifest compiler
- Huddle session model
- Minimal typed canvas
- Decision capture
- Work item graph
- Gate model
- Agent pack schema
- One external agent adapter
- Work context pack generation
- Evidence capture
- Basic review center

The MVP can defer:

- Full natural voice UX
- Full whiteboard-style canvas
- Full PM replacement
- Full multi-provider parity
- Full incident automation
- Production runbook execution
- Advanced analytics
- Marketplace/plugin distribution

## 8. MVP Success Definition

Palpa MVP is successful when:

1. A founder, PM, or architect can run a huddle for a new feature.
2. Palpa turns the conversation into typed decisions, risks, work items, and gates.
3. Palpa uses manifests and C4 fragments to show architecture impact.
4. A Codex or Claude role agent can contribute meaningfully inside the huddle.
5. A locked work item can be handed to a coding agent.
6. The agent produces a PR with evidence.
7. A human can review and approve through Palpa.
8. The entire path is traceable from product intent to code change.

## 9. Strategic Wedge

The first differentiated product experience is not generic AI coding.

It is:

> Feature huddle → typed decisions → C4/manifest/schema impact → draft work items → agent contribution → locked work item → external coding agent execution → PR with evidence → human review gate.

This is the first vertical slice to build.
