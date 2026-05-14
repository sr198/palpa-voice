## Objective

Build a portable agent runtime package for Palpa that can drive Codex now and other coding harnesses later, without baking voice or UI policy into the core abstraction.

The first product validation is not voice. It is a chat-backed integration inside the existing Palpa product that can interact with a local Codex agent similarly to the VS Code extension or Codex chat surfaces:

- persistent sessions
- one or more runs per session
- live streaming updates
- approvals from day one
- modest persistence and replay

Sources that shaped this design:

- OpenAI Codex harness post: https://openai.com/index/unlocking-the-codex-harness/
- Codex app-server README: https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md
- VS Code agent sessions overview: https://code.visualstudio.com/learn/foundations/agent-sessions-and-where-agents-run
- VS Code agents overview: https://code.visualstudio.com/docs/copilot/agents/overview

## Module Boundary

What this module is:

- A shared workspace package, likely `@palpa/agent-runtime`
- A neutral runtime API centered on `session` and `run`
- A provider abstraction that can map Codex today and other harnesses later
- A session manager that owns event normalization, replay, approvals, and persistence hooks

What this module is not:

- An HTTP server
- A browser client
- A voice-specific formatting layer
- A repo-specific prompt policy
- A UI permission workflow

The host application owns transport and UI. The runtime package owns the agent interaction model.

## Public Model

The public contract should stay neutral even though Codex internally speaks in terms of `Thread`, `Turn`, and `Item`.

Recommended public primitives:

- `RuntimeSession`: a long-lived conversation container
- `RuntimeRun`: one agent execution cycle within a session
- `RuntimeInput`: typed inputs sent to a run
- `RuntimeEvent`: a normalized stream of all output, progress, approvals, and terminal states
- `ApprovalDecision`: explicit responses for interactive provider approvals

Codex-specific identifiers should remain available as source metadata, but not define the public API.

## Contract Shape

The contract needs to support:

- session create, resume, import, archive, delete
- run start and interrupt
- typed input arrays from day one
- one unified event stream
- approvals from day one
- replay from a cursor
- provider capability discovery
- pluggable persistence

Illustrative TypeScript shape:

```ts
export interface RuntimeSession {
  id: string;
  providerId: string;
  title: string | null;
  cwd: string | null;
  createdAt: number;
  updatedAt: number;
  status: 'idle' | 'running' | 'waiting_for_approval' | 'completed' | 'failed' | 'archived';
  binding?: ProviderBinding;
  metadata?: Record<string, unknown>;
}

export interface RuntimeRun {
  id: string;
  sessionId: string;
  status: 'queued' | 'running' | 'waiting_for_approval' | 'interrupted' | 'completed' | 'failed';
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  metadata?: Record<string, unknown>;
}

export type RuntimeInput =
  | { type: 'text'; text: string }
  | { type: 'image'; imageUrl: string; mimeType?: string }
  | { type: 'context'; label: string; value: string }
  | { type: 'attachment'; name: string; uri: string; mimeType?: string };

export type RuntimeEvent =
  | { type: 'session.created'; sessionId: string }
  | { type: 'session.updated'; sessionId: string; status: RuntimeSession['status'] }
  | { type: 'run.started'; sessionId: string; runId: string }
  | { type: 'run.completed'; sessionId: string; runId: string; status: RuntimeRun['status'] }
  | { type: 'message.delta'; sessionId: string; runId: string; text: string }
  | { type: 'message.completed'; sessionId: string; runId: string; role: 'assistant' | 'user'; text: string }
  | { type: 'reasoning.delta'; sessionId: string; runId: string; text: string }
  | { type: 'plan.updated'; sessionId: string; runId: string; steps: PlanStep[] }
  | { type: 'tool.started'; sessionId: string; runId: string; toolName: string }
  | { type: 'tool.updated'; sessionId: string; runId: string; toolName: string; detail: string }
  | { type: 'tool.completed'; sessionId: string; runId: string; toolName: string; status: 'completed' | 'failed' }
  | { type: 'command.started'; sessionId: string; runId: string; argv: string[]; cwd?: string }
  | { type: 'command.output'; sessionId: string; runId: string; stream: 'stdout' | 'stderr'; chunk: string }
  | { type: 'command.completed'; sessionId: string; runId: string; exitCode: number }
  | { type: 'file.updated'; sessionId: string; runId: string; path: string; patch?: string }
  | { type: 'approval.requested'; sessionId: string; runId: string; approval: ApprovalRequest }
  | { type: 'approval.resolved'; sessionId: string; runId: string; approvalId: string; decision: ApprovalDecision }
  | { type: 'error'; sessionId?: string; runId?: string; code: string; message: string; retryable?: boolean };

export type ApprovalRequest =
  | {
      id: string;
      kind: 'command';
      command: string[];
      cwd?: string;
      reason?: string;
      availableDecisions: ApprovalDecisionType[];
      metadata?: Record<string, unknown>;
    }
  | {
      id: string;
      kind: 'file';
      changes: FileChange[];
      reason?: string;
      availableDecisions: ApprovalDecisionType[];
      metadata?: Record<string, unknown>;
    };

export type ApprovalDecisionType =
  | 'approve'
  | 'approve_for_session'
  | 'reject'
  | 'cancel'
  | 'approve_with_changes';

export type ApprovalDecision =
  | { type: 'approve' }
  | { type: 'approve_for_session' }
  | { type: 'reject' }
  | { type: 'cancel' }
  | { type: 'approve_with_changes'; command: string[] };

export interface AgentProvider {
  readonly id: string;
  readonly capabilities: ProviderCapabilities;

  initialize(): Promise<void>;
  shutdown(): Promise<void>;

  createSession(params: CreateSessionParams): Promise<ProviderSessionHandle>;
  bindSession(params: BindSessionParams): Promise<ProviderSessionHandle>;
  resumeSession(params: ResumeSessionParams): Promise<ProviderSessionHandle>;
  archiveSession(params: ArchiveSessionParams): Promise<void>;
  deleteSession?(params: DeleteSessionParams): Promise<void>;
  listSessions?(params?: ListSessionsParams): Promise<ProviderSessionHandle[]>;

  createRun(params: CreateRunParams): Promise<ProviderRunHandle>;
  interruptRun(params: InterruptRunParams): Promise<void>;
  respondToApproval(params: RespondToApprovalParams): Promise<void>;

  stream(params?: StreamParams): AsyncIterable<ProviderEvent>;
}

export interface AgentRuntime {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  createSession(params: CreateRuntimeSessionParams): Promise<RuntimeSession>;
  bindSession(params: BindRuntimeSessionParams): Promise<RuntimeSession>;
  resumeSession(sessionId: string): Promise<RuntimeSession>;
  listSessions(): Promise<RuntimeSession[]>;
  archiveSession(sessionId: string): Promise<void>;
  createRun(params: CreateRuntimeRunParams): Promise<RuntimeRun>;
  interruptRun(sessionId: string, runId: string): Promise<void>;
  respondToApproval(sessionId: string, runId: string, approvalId: string, decision: ApprovalDecision): Promise<void>;
  subscribe(sessionId: string, options?: { cursor?: string; signal?: AbortSignal }): AsyncIterable<RuntimeEventEnvelope>;
}
```

## Why `session + run`

This naming keeps the public API portable.

- Codex maps cleanly: `thread -> session`, `turn -> run`
- A different harness may have different internal concepts, but still supports a long-lived conversation plus one execution cycle
- The model works for persistent chat, IDE task panes, background coding agents, and future voice-triggered flows

## Why Typed Input

Typed input avoids painting the runtime into a plain-text corner.

The first product integration may send mostly text, but the API should already support:

- prompt text
- attachments
- structured context
- images
- future audio-related metadata without changing the contract

The runtime should treat input as an ordered array of typed items.

## Why One Unified Event Stream

The host application should have one timeline to render, persist, and replay.

That timeline needs to capture:

- session lifecycle
- run lifecycle
- message streaming
- reasoning and plan updates
- command and tool progress
- file changes and diffs
- approvals
- failures

Approvals are still actionable through a dedicated runtime method, but the request itself should appear in the same event history as everything else.

## Provider Binding

The runtime should support both:

- native session creation through the provider
- explicit binding/import of an existing provider session identifier

This matters for:

- manual migration from earlier Palpa experiments
- debugging a live Codex thread outside the normal create flow
- importing provider-owned sessions discovered elsewhere

The public session record should store a provider binding, for example:

```ts
interface ProviderBinding {
  providerSessionId: string;
  providerThreadId?: string;
  metadata?: Record<string, unknown>;
}
```

## Pluggable Persistence

Persistence belongs to the runtime contract, but the storage backend should be supplied by the host.

Required v1 store responsibilities:

- save and read runtime sessions
- save and read runtime runs
- append events to a session log
- replay events from an opaque cursor
- track open approvals
- mark approvals as resolved

The runtime package should ship:

- a `RuntimeStore` interface
- an in-memory implementation for tests and local development

The host app can later provide SQLite, Postgres, Redis, or another durable store without changing the runtime API.

## Session Manager Responsibilities

The shared package should expose a session manager that wraps one provider instance and adds host-facing behavior:

- local registry of active sessions and runs
- normalized event envelopes with cursors and timestamps
- live fanout to multiple subscribers
- append-only persistence through the store interface
- replay for reconnecting clients
- approval bookkeeping
- session status transitions

HTTP and WebSocket handlers should talk to this layer, not directly to the provider.

## Codex Provider Responsibilities

The first concrete adapter is `CodexProvider`.

It should own:

- app-server process lifecycle
- initialize-once handshake
- request/response framing over JSONL stdio
- retry strategy for retryable server overload failures
- mapping Codex thread lifecycle to runtime session lifecycle
- mapping Codex turn lifecycle to runtime run lifecycle
- mapping Codex item notifications to runtime events
- mapping command and file approvals into `approval.requested`
- forwarding approval decisions back to the app-server
- optional provider metadata for debugging

It should not leak raw Codex protocol shapes into the public runtime API except as source metadata.

## What v1 Explicitly Includes

- single-agent sessions
- multiple independent sessions per repo/product user
- chat-oriented runtime semantics
- streaming progress and tool activity
- command approvals from day one
- file-change approvals from day one
- run interruption
- replayable event history
- deterministic unit and integration tests using a fake provider or fake app-server

## What v1 Explicitly Defers

- multi-agent orchestration inside a single session
- voice prompting or spoken-output formatting
- provider load balancing
- plugin marketplace management
- UI design choices beyond the runtime requirements they imply
- durable cross-process locking or distributed coordination

## Delivery Plan

1. Define the neutral runtime types and interfaces.
2. Scaffold `packages/agent-runtime`.
3. Implement the session manager and pluggable store contract.
4. Add an in-memory store and a mock provider.
5. Add deterministic unit tests around the neutral contract.
6. Implement `CodexProvider` against the real app-server protocol.
7. Replace the app-specific Codex client usage in the API with the shared runtime.
8. Expose the runtime through chat-oriented backend endpoints and streaming transport.

## Success Criteria

The runtime is ready for product integration when:

1. The host app can create, bind, resume, and archive sessions through a neutral API.
2. The host app can start a run with typed input and receive a replayable unified event stream.
3. The host app can surface and resolve both command and file approvals through the runtime.
4. Codex-specific protocol details remain confined to the provider adapter.
5. The package is covered by deterministic unit and fake-server integration tests.
