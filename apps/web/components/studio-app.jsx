'use client';

import { startTransition, useEffect, useEffectEvent, useRef, useState } from 'react';

const apiOrigin = process.env.NEXT_PUBLIC_API_ORIGIN || 'http://127.0.0.1:3001';
const navItems = [
  { id: 'studio', label: 'Studio', enabled: true },
  { id: 'repo-graph', label: 'Repo Graph', enabled: false },
  { id: 'work-graph', label: 'Work Graph', enabled: false },
  { id: 'agents', label: 'Agents', enabled: false },
  { id: 'assurance', label: 'Assurance', enabled: false },
  { id: 'operate', label: 'Operate', enabled: false }
];

function createSessionView() {
  return {
    cursor: null,
    transcript: [],
    approvals: [],
    draftArtifacts: [],
    promotedArtifacts: [],
    activities: [],
    files: [],
    tools: [],
    plans: [],
    streamingByRun: {},
    runStatus: 'idle',
    activeRunId: null,
    reconnecting: false
  };
}

function formatTime(value = Date.now()) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit'
    }).format(value);
  } catch {
    return '';
  }
}

function formatSessionTime(session) {
  if (!session?.updated_at) {
    return 'Awaiting activity';
  }

  return `Updated ${formatTime(session.updated_at)}`;
}

function cx(...parts) {
  return parts.filter(Boolean).join(' ');
}

function dedupeBy(items, key) {
  const seen = new Set();
  const output = [];

  for (const item of items) {
    const value = key(item);
    if (!value || seen.has(value)) {
      continue;
    }

    seen.add(value);
    output.push(item);
  }

  return output;
}

function upsertArtifact(list, artifact) {
  const existingIndex = list.findIndex((entry) => entry.id === artifact.id);
  if (existingIndex === -1) {
    return [artifact, ...list].slice(0, 8);
  }

  const next = [...list];
  next[existingIndex] = {
    ...next[existingIndex],
    ...artifact
  };
  return next;
}

function upsertApproval(list, approval) {
  const existingIndex = list.findIndex((entry) => entry.id === approval.id);
  if (existingIndex === -1) {
    return [approval, ...list];
  }

  const next = [...list];
  next[existingIndex] = {
    ...next[existingIndex],
    ...approval
  };
  return next;
}

function summarizeEvent(event) {
  switch (event.type) {
    case 'run.started':
      return 'Run started';
    case 'run.completed':
      return `Run ${event.status}`;
    case 'approval.requested':
      return `Approval requested: ${event.approval?.kind || 'action'}`;
    case 'approval.resolved':
      return `Approval ${event.decision?.type || 'resolved'}`;
    case 'command.started':
      return `Command: ${(event.argv || []).join(' ')}`;
    case 'command.completed':
      return `Command completed with exit code ${event.exitCode}`;
    case 'tool.started':
      return `Tool: ${event.toolName}`;
    case 'tool.completed':
      return `Tool ${event.toolName} ${event.status}`;
    case 'file.updated':
      return `Updated ${event.path}`;
    case 'plan.updated':
      return `Plan updated with ${(event.steps || []).length} steps`;
    case 'message.completed':
      return 'Agent replied';
    case 'error':
      return event.message || 'Runtime error';
    default:
      return event.type;
  }
}

function buildActivity(event) {
  return {
    id: `${event.type}:${event.runId || 'session'}:${event.path || event.toolName || event.approval?.id || ''}:${Math.random().toString(36).slice(2, 8)}`,
    type: event.type,
    label: summarizeEvent(event),
    ts: formatTime(),
    event
  };
}

function applyRuntimeEvent(previous, entry, agentName) {
  const next = {
    ...previous,
    cursor: entry.cursor || previous.cursor
  };
  const event = entry.event;

  switch (event.type) {
    case 'run.started': {
      next.runStatus = 'running';
      next.activeRunId = event.runId;
      next.activities = [buildActivity(event), ...previous.activities].slice(0, 24);
      return next;
    }
    case 'message.delta': {
      next.streamingByRun = {
        ...previous.streamingByRun,
        [event.runId]: ((previous.streamingByRun[event.runId] || '') + (event.text || '')).trimStart()
      };
      return next;
    }
    case 'message.completed': {
      const streamingByRun = { ...previous.streamingByRun };
      delete streamingByRun[event.runId];
      next.streamingByRun = streamingByRun;
      next.transcript = [
        ...previous.transcript,
        {
          id: `${event.runId}:assistant`,
          kind: 'agent',
          speaker: agentName,
          body: event.text || '',
          ts: formatTime()
        }
      ];
      next.draftArtifacts = upsertArtifact(previous.draftArtifacts, {
        id: `artifact:${event.runId}:response`,
        kind: 'note',
        title: 'Agent response',
        body: event.text || '',
        status: 'draft',
        source: agentName
      });
      next.activities = [buildActivity(event), ...previous.activities].slice(0, 24);
      return next;
    }
    case 'approval.requested': {
      next.approvals = upsertApproval(previous.approvals, {
        id: event.approval.id,
        runId: event.runId,
        kind: event.approval.kind || 'approval',
        status: 'pending',
        command: event.approval.command || [],
        cwd: event.approval.cwd || null,
        path: event.approval.path || null,
        reason: event.approval.reason || null,
        decisions: event.approval.availableDecisions || ['approve', 'reject']
      });
      next.runStatus = 'waiting_for_approval';
      next.activities = [buildActivity(event), ...previous.activities].slice(0, 24);
      return next;
    }
    case 'approval.resolved': {
      next.approvals = previous.approvals.map((approval) => (
        approval.id === event.approvalId
          ? { ...approval, status: event.decision?.type || 'resolved' }
          : approval
      ));
      next.runStatus = 'running';
      next.activities = [buildActivity(event), ...previous.activities].slice(0, 24);
      return next;
    }
    case 'command.started':
    case 'command.completed':
    case 'tool.started':
    case 'tool.completed':
    case 'file.updated':
    case 'plan.updated':
    case 'error': {
      next.activities = [buildActivity(event), ...previous.activities].slice(0, 24);

      if (event.type === 'tool.started' || event.type === 'tool.completed') {
        next.tools = dedupeBy(
          [{ name: event.toolName, status: event.status || 'active' }, ...previous.tools],
          (item) => item.name
        ).slice(0, 10);
      }

      if (event.type === 'file.updated') {
        next.files = dedupeBy(
          [{ path: event.path, kind: event.metadata?.kind || 'updated' }, ...previous.files],
          (item) => item.path
        ).slice(0, 10);
        next.draftArtifacts = upsertArtifact(previous.draftArtifacts, {
          id: `artifact:${event.path}`,
          kind: 'file',
          title: event.path,
          body: event.patch || 'Pending diff details',
          status: 'draft',
          source: 'Runtime'
        });
      }

      if (event.type === 'plan.updated') {
        next.plans = event.steps || [];
        next.draftArtifacts = upsertArtifact(previous.draftArtifacts, {
          id: `artifact:${event.runId}:plan`,
          kind: 'plan',
          title: event.metadata?.explanation || 'Plan update',
          body: (event.steps || []).map((step) => `${step.status || 'pending'} · ${step.step}`).join('\n'),
          status: 'draft',
          source: agentName
        });
      }

      if (event.type === 'error') {
        next.runStatus = 'failed';
      }

      return next;
    }
    case 'run.completed': {
      next.runStatus = event.status || 'completed';
      next.activeRunId = null;
      next.activities = [buildActivity(event), ...previous.activities].slice(0, 24);
      return next;
    }
    default:
      return next;
  }
}

function statusTone(status) {
  switch (status) {
    case 'running':
    case 'completed':
    case 'approved':
      return 'text-success';
    case 'waiting_for_approval':
    case 'pending':
      return 'text-warning';
    case 'failed':
    case 'rejected':
      return 'text-danger';
    default:
      return 'text-muted';
  }
}

function ArtifactCard({ artifact, onPromote, promoted = false }) {
  return (
    <div className="palpa-panel rounded-panel p-4 transition-transform duration-150 ease-productive hover:-translate-y-px">
      <div className="mb-3 flex items-center gap-2">
        <span className="rounded-chip bg-brandSoft px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-brand">
          {artifact.kind}
        </span>
        <span className={cx('font-mono text-[11px]', promoted ? 'text-success' : 'text-dim')}>
          {promoted ? 'promoted' : artifact.status}
        </span>
      </div>
      <div className="mb-2 text-sm font-medium text-ink">{artifact.title}</div>
      <div className="whitespace-pre-wrap text-xs leading-5 text-muted">
        {artifact.body || 'No preview yet.'}
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-lineSubtle pt-3">
        <span className="text-xs text-dim">{artifact.source}</span>
        {!promoted ? (
          <button
            type="button"
            onClick={() => onPromote(artifact.id)}
            className="rounded-chip bg-panelRaised px-3 py-1.5 text-xs text-ink transition-colors hover:bg-brandSoft hover:text-brand"
          >
            Promote
          </button>
        ) : (
          <span className="text-xs text-success">Pinned to canvas</span>
        )}
      </div>
    </div>
  );
}

export default function StudioApp() {
  const [bootstrap, setBootstrap] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [sessionView, setSessionView] = useState(createSessionView);
  const [composer, setComposer] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState('architect');
  const [busy, setBusy] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [reconnectNonce, setReconnectNonce] = useState(0);
  const [pendingApprovalId, setPendingApprovalId] = useState(null);

  const sessionRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const cursorRef = useRef(null);
  const subscribedSessionIdRef = useRef(null);

  const activeSession = sessions.find((session) => session.id === activeSessionId) || null;
  const activeAgent = bootstrap?.agents?.find((agent) => agent.id === activeSession?.agent?.id)
    || bootstrap?.agents?.find((agent) => agent.id === selectedAgentId)
    || null;
  const repoName = bootstrap?.codex?.cwd?.split('/').filter(Boolean).at(-1) || 'repo';
  const workItemTitle = activeSession?.title || 'Studio work item';

  const refreshSessions = useEffectEvent(async () => {
    const response = await fetch(`${apiOrigin}/chat/sessions`);
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Unable to load sessions.');
    }
    setSessions(payload.sessions || []);
    return payload.sessions || [];
  });

  const createSession = useEffectEvent(async (agentId) => {
    const response = await fetch(`${apiOrigin}/chat/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: agentId
          ? `${bootstrap?.agents?.find((agent) => agent.id === agentId)?.name || 'Agent'} room`
          : 'Palpa studio room',
        agent_id: agentId || selectedAgentId
      })
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Unable to create room.');
    }

    startTransition(() => {
      setSessions((current) => [payload.session, ...current]);
      setActiveSessionId(payload.session.id);
      setSessionView(createSessionView());
    });

    return payload.session;
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const bootstrapResponse = await fetch(`${apiOrigin}/chat/bootstrap`);
        const bootstrapPayload = await bootstrapResponse.json();
        if (!bootstrapResponse.ok) {
          throw new Error(bootstrapPayload.error || 'Unable to load chat bootstrap.');
        }

        if (cancelled) {
          return;
        }

        setBootstrap(bootstrapPayload);
        setSelectedAgentId(bootstrapPayload.agents?.[0]?.id || 'architect');

        const loadedSessions = await refreshSessions();
        if (cancelled) {
          return;
        }

        if (loadedSessions.length) {
          setActiveSessionId(loadedSessions[0].id);
        } else {
          await createSession(bootstrapPayload.agents?.[0]?.id || 'architect');
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Unable to initialize studio.');
        }
      } finally {
        if (!cancelled) {
          setBusy(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [createSession, refreshSessions]);

  useEffect(() => {
    if (!activeSessionId) {
      return undefined;
    }

    if (subscribedSessionIdRef.current !== activeSessionId) {
      subscribedSessionIdRef.current = activeSessionId;
      setSessionView(createSessionView());
      cursorRef.current = null;
    }

    setError('');
    sessionRef.current?.close?.();
    clearTimeout(reconnectTimerRef.current);

    const source = new EventSource(
      `${apiOrigin}/chat/sessions/${activeSessionId}/events${cursorRef.current ? `?cursor=${encodeURIComponent(cursorRef.current)}` : ''}`
    );
    sessionRef.current = source;

    source.addEventListener('runtime', (message) => {
      const entry = JSON.parse(message.data);
      cursorRef.current = entry.cursor || cursorRef.current;
      startTransition(() => {
        setSessionView((current) => applyRuntimeEvent(current, entry, activeAgent?.name || 'Agent'));
      });
    });

    source.addEventListener('ready', () => {
      startTransition(() => {
        setSessionView((current) => ({
          ...current,
          reconnecting: false
        }));
      });
    });

    source.onerror = () => {
      source.close();
      startTransition(() => {
        setSessionView((current) => ({
          ...current,
          reconnecting: true
        }));
      });
      reconnectTimerRef.current = setTimeout(() => {
        setReconnectNonce((value) => value + 1);
      }, 1200);
    };

    return () => {
      source.close();
      clearTimeout(reconnectTimerRef.current);
    };
  }, [activeAgent?.name, activeSessionId, reconnectNonce]);

  async function handleSend(event) {
    event.preventDefault();
    const text = composer.trim();
    if (!text || !activeSessionId) {
      return;
    }

    setSending(true);
    setComposer('');
    setSessionView((current) => ({
      ...current,
      transcript: [
        ...current.transcript,
        {
          id: `user:${Date.now()}`,
          kind: 'human',
          speaker: 'You',
          body: text,
          ts: formatTime()
        }
      ]
    }));

    try {
      const response = await fetch(`${apiOrigin}/chat/sessions/${activeSessionId}/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to submit run.');
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unable to submit run.');
    } finally {
      setSending(false);
    }
  }

  async function handleInterrupt() {
    if (!activeSessionId || !sessionView.activeRunId) {
      return;
    }

    try {
      const response = await fetch(
        `${apiOrigin}/chat/sessions/${activeSessionId}/runs/${sessionView.activeRunId}/interrupt`,
        { method: 'POST' }
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to interrupt run.');
      }
    } catch (interruptError) {
      setError(interruptError instanceof Error ? interruptError.message : 'Unable to interrupt run.');
    }
  }

  async function handleApproval(approvalId, decisionType) {
    if (!activeSessionId) {
      return;
    }

    const approval = sessionView.approvals.find((entry) => entry.id === approvalId);
    if (!approval?.runId) {
      return;
    }

    setPendingApprovalId(approvalId);

    try {
      const response = await fetch(
        `${apiOrigin}/chat/sessions/${activeSessionId}/runs/${approval.runId}/approvals/${approvalId}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision: { type: decisionType } })
        }
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to resolve approval.');
      }
    } catch (approvalError) {
      setError(approvalError instanceof Error ? approvalError.message : 'Unable to resolve approval.');
    } finally {
      setPendingApprovalId(null);
    }
  }

  function promoteArtifact(artifactId) {
    setSessionView((current) => {
      const artifact = current.draftArtifacts.find((entry) => entry.id === artifactId);
      if (!artifact) {
        return current;
      }

      return {
        ...current,
        promotedArtifacts: upsertArtifact(current.promotedArtifacts, {
          ...artifact,
          status: 'promoted'
        })
      };
    });
  }

  const streamingText = sessionView.activeRunId ? sessionView.streamingByRun[sessionView.activeRunId] : '';
  const pendingApprovals = sessionView.approvals.filter((approval) => approval.status === 'pending');

  return (
    <div className="flex min-h-screen bg-canvas text-ink">
      <aside className="hidden w-[68px] shrink-0 border-r border-lineSubtle bg-canvas md:flex md:flex-col md:items-center md:px-3 md:py-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-gradient-to-br from-brand to-[#5b4ed0] text-sm font-semibold text-white shadow-raised">
          P
        </div>
        <div className="mt-4 h-px w-8 bg-lineSubtle" />
        <nav className="mt-4 flex flex-1 flex-col gap-2">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={cx(
                'rounded-panel px-2 py-2 text-left text-[11px] leading-4 transition-colors',
                item.id === 'studio'
                  ? 'bg-brandSoft text-brand'
                  : item.enabled
                    ? 'text-muted hover:bg-panel hover:text-ink'
                    : 'text-dim'
              )}
            >
              <span className="block font-medium">{item.label}</span>
              {!item.enabled && <span className="block text-[10px]">Soon</span>}
            </button>
          ))}
        </nav>
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#3a2f1e] text-[10px] font-semibold text-[#e89b4c]">
          MK
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-14 items-center gap-3 border-b border-lineSubtle px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-muted">
              <span>{repoName}</span>
              <span className="text-dim">/</span>
              <span>Studio</span>
            </div>
            <div className="truncate text-sm font-medium text-ink">{workItemTitle}</div>
          </div>

          <div className="hidden min-w-0 flex-1 items-center gap-2 lg:flex">
            <div className="palpa-pill bg-panel px-3 py-2 text-xs text-muted">
              <span className="h-2 w-2 rounded-full bg-danger palpa-live-dot" />
              Room
              <span className="font-mono text-dim">{activeSession?.id || 'pending'}</span>
            </div>
            <div className="palpa-pill bg-panel px-3 py-2 text-xs text-muted">
              Host agent
              <span className="text-ink">{activeAgent?.name || 'Loading'}</span>
            </div>
            <div className="palpa-pill bg-panel px-3 py-2 text-xs text-muted">
              {formatSessionTime(activeSession)}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-2 rounded-panel bg-panel px-3 py-2 text-xs text-muted sm:flex">
              <span className="text-dim">Search graph</span>
              <span className="palpa-kbd">⌘K</span>
            </div>
            <button
              type="button"
              onClick={() => void createSession(selectedAgentId)}
              className="rounded-chip bg-brand px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-[#6f5df7]"
            >
              New room
            </button>
          </div>
        </header>

        <main className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1.35fr_minmax(380px,1fr)]">
          <section className="palpa-dot-grid border-b border-r border-lineSubtle lg:border-b-0">
            <div className="flex h-full min-h-[360px] flex-col px-4 py-4 sm:px-5">
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <span className="text-[11px] uppercase tracking-[0.08em] text-dim">Canvas</span>
                <span className="font-mono text-[11px] text-dim">
                  {sessionView.promotedArtifacts.length} promoted · {sessionView.draftArtifacts.length} drafts
                </span>
                {sessionView.reconnecting && (
                  <span className="rounded-chip bg-[rgba(245,158,11,0.10)] px-2 py-1 font-mono text-[10px] text-warning">
                    reconnecting
                  </span>
                )}
              </div>

              <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
                <div className="flex min-h-0 flex-col gap-4">
                  <div className="palpa-panel-raised rounded-panel p-4">
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.08em] text-dim">Session Summary</div>
                        <div className="mt-2 text-lg font-medium text-ink">{workItemTitle}</div>
                      </div>
                      <span className={cx('font-mono text-xs', statusTone(sessionView.runStatus))}>
                        {sessionView.runStatus}
                      </span>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-panel bg-panel p-3">
                        <div className="text-[11px] uppercase tracking-[0.08em] text-dim">Current room</div>
                        <div className="mt-2 font-mono text-sm text-ink">{activeSession?.id || 'Creating'}</div>
                        <div className="mt-1 text-xs text-muted">
                          Shared huddle shell with a real runtime-backed chat loop.
                        </div>
                      </div>
                      <div className="rounded-panel bg-panel p-3">
                        <div className="text-[11px] uppercase tracking-[0.08em] text-dim">Host specialist</div>
                        <div className="mt-2 text-sm font-medium text-ink">{activeAgent?.name || 'Loading'}</div>
                        <div className="mt-1 text-xs text-muted">{activeAgent?.summary || 'Awaiting bootstrap.'}</div>
                      </div>
                      <div className="rounded-panel bg-panel p-3">
                        <div className="text-[11px] uppercase tracking-[0.08em] text-dim">Approvals waiting</div>
                        <div className="mt-2 text-2xl font-medium text-ink">{pendingApprovals.length}</div>
                        <div className="mt-1 text-xs text-muted">Human judgment stays visible in the room.</div>
                      </div>
                      <div className="rounded-panel bg-panel p-3">
                        <div className="text-[11px] uppercase tracking-[0.08em] text-dim">Recent activity</div>
                        <div className="mt-2 text-2xl font-medium text-ink">{sessionView.activities.length}</div>
                        <div className="mt-1 text-xs text-muted">Commands, tools, plans, files, and replies.</div>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-4 xl:grid-cols-2">
                    <div className="min-h-[220px] rounded-panel border border-lineSubtle bg-panel p-4">
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <div>
                          <div className="text-[11px] uppercase tracking-[0.08em] text-dim">Draft Artifacts</div>
                          <div className="mt-1 text-sm text-muted">Agent outputs waiting for promotion.</div>
                        </div>
                        <span className="font-mono text-[11px] text-dim">{sessionView.draftArtifacts.length}</span>
                      </div>
                      <div className="palpa-scrollbar space-y-3 overflow-y-auto pr-1">
                        {sessionView.draftArtifacts.length ? sessionView.draftArtifacts.map((artifact) => (
                          <ArtifactCard
                            key={artifact.id}
                            artifact={artifact}
                            onPromote={promoteArtifact}
                          />
                        )) : (
                          <div className="rounded-panel border border-dashed border-line p-4 text-sm text-muted">
                            Draft plans, file changes, and agent notes will collect here as the room works.
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="min-h-[220px] rounded-panel border border-lineSubtle bg-panel p-4">
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <div>
                          <div className="text-[11px] uppercase tracking-[0.08em] text-dim">Promoted Items</div>
                          <div className="mt-1 text-sm text-muted">Pinned outputs that become durable room context.</div>
                        </div>
                        <span className="font-mono text-[11px] text-dim">{sessionView.promotedArtifacts.length}</span>
                      </div>
                      <div className="palpa-scrollbar space-y-3 overflow-y-auto pr-1">
                        {sessionView.promotedArtifacts.length ? sessionView.promotedArtifacts.map((artifact) => (
                          <ArtifactCard
                            key={artifact.id}
                            artifact={artifact}
                            onPromote={() => {}}
                            promoted
                          />
                        )) : (
                          <div className="rounded-panel border border-dashed border-line p-4 text-sm text-muted">
                            Promote draft artifacts here to simulate the future canvas truth flow.
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex min-h-0 flex-col gap-4">
                  <div className="rounded-panel border border-lineSubtle bg-panel p-4">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.08em] text-dim">Approvals</div>
                        <div className="mt-1 text-sm text-muted">Inline human decisions on runtime actions.</div>
                      </div>
                      <span className="font-mono text-[11px] text-dim">{pendingApprovals.length} pending</span>
                    </div>
                    <div className="space-y-3">
                      {pendingApprovals.length ? pendingApprovals.map((approval) => (
                        <div key={approval.id} className="palpa-panel rounded-panel p-4">
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <span className="rounded-chip bg-[rgba(245,158,11,0.10)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-warning">
                              {approval.kind}
                            </span>
                            <span className="font-mono text-[11px] text-dim">{approval.id}</span>
                          </div>
                          {approval.command.length ? (
                            <div className="font-mono text-xs text-ink">{approval.command.join(' ')}</div>
                          ) : (
                            <div className="text-sm text-ink">{approval.path || approval.reason || 'Approval required'}</div>
                          )}
                          {approval.cwd && <div className="mt-1 font-mono text-[11px] text-dim">{approval.cwd}</div>}
                          <div className="mt-4 flex flex-wrap gap-2">
                            {approval.decisions.map((decision) => (
                              <button
                                key={decision}
                                type="button"
                                disabled={pendingApprovalId === approval.id}
                                onClick={() => void handleApproval(approval.id, decision)}
                                className={cx(
                                  'rounded-chip px-3 py-1.5 text-xs capitalize transition-colors',
                                  decision.includes('approve')
                                    ? 'bg-[rgba(16,185,129,0.10)] text-success hover:bg-[rgba(16,185,129,0.18)]'
                                    : 'bg-[rgba(239,68,68,0.10)] text-danger hover:bg-[rgba(239,68,68,0.18)]'
                                )}
                              >
                                {decision.replaceAll('_', ' ')}
                              </button>
                            ))}
                          </div>
                        </div>
                      )) : (
                        <div className="rounded-panel border border-dashed border-line p-4 text-sm text-muted">
                          Pending approvals will land here and in the utility stack.
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="rounded-panel border border-lineSubtle bg-panel p-4">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.08em] text-dim">Activity Snapshot</div>
                        <div className="mt-1 text-sm text-muted">Immediate repo-facing work in the current room.</div>
                      </div>
                    </div>
                    <div className="space-y-2">
                      {sessionView.activities.slice(0, 6).map((activity) => (
                        <div key={activity.id} className="flex items-start justify-between gap-3 rounded-panel bg-panel p-3">
                          <div>
                            <div className="text-sm text-ink">{activity.label}</div>
                            <div className="mt-1 font-mono text-[11px] text-dim">{activity.type}</div>
                          </div>
                          <span className="font-mono text-[11px] text-dim">{activity.ts}</span>
                        </div>
                      ))}
                      {!sessionView.activities.length && (
                        <div className="rounded-panel border border-dashed border-line p-4 text-sm text-muted">
                          Runtime events will accumulate here as soon as the room starts doing work.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="grid min-h-[50vh] grid-rows-[minmax(0,1fr)_minmax(320px,0.9fr)]">
            <div className="flex min-h-0 flex-col border-b border-lineSubtle">
              <div className="flex items-center justify-between gap-3 border-b border-lineSubtle px-4 py-3">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.08em] text-dim">Huddle Transcript</div>
                  <div className="mt-1 text-sm text-muted">Shared room with visible speaker identity and runtime state.</div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-chip bg-brandSoft px-2 py-1 text-xs text-brand">
                    Room default routing
                  </span>
                  <span className={cx('font-mono text-xs', statusTone(sessionView.runStatus))}>
                    {sessionView.runStatus}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 border-b border-lineSubtle px-4 py-3">
                <span className="text-xs text-dim">Present</span>
                <span className="rounded-chip bg-panel px-2 py-1 text-xs text-ink">You</span>
                {bootstrap?.agents?.map((agent) => (
                  <span
                    key={agent.id}
                    className={cx(
                      'rounded-chip px-2 py-1 text-xs',
                      activeSession?.agent?.id === agent.id ? 'bg-brandSoft text-brand' : 'bg-panel text-muted'
                    )}
                  >
                    {agent.name}
                  </span>
                ))}
              </div>

              <div className="palpa-scrollbar flex-1 overflow-y-auto px-4 py-4">
                {busy ? (
                  <div className="text-sm text-muted">Bootstrapping studio...</div>
                ) : (
                  <div className="space-y-4">
                    {sessionView.transcript.map((entry) => (
                      <div key={entry.id} className="flex gap-3">
                        <div
                          className={cx(
                            'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold',
                            entry.kind === 'human'
                              ? 'bg-[#3a2f1e] text-[#e89b4c]'
                              : 'rounded-chip bg-[#0e1217] text-info palpa-hairline'
                          )}
                        >
                          {entry.kind === 'human' ? 'YOU' : 'AI'}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="mb-1 flex items-center gap-2">
                            <span className="text-sm font-medium text-ink">{entry.speaker}</span>
                            <span className="font-mono text-[11px] text-dim">{entry.ts}</span>
                          </div>
                          <div className="whitespace-pre-wrap text-sm leading-6 text-muted">{entry.body}</div>
                        </div>
                      </div>
                    ))}

                    {streamingText && (
                      <div className="flex gap-3">
                        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-chip bg-[#0e1217] text-info palpa-hairline">
                          AI
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="mb-1 flex items-center gap-2">
                            <span className="text-sm font-medium text-ink">{activeAgent?.name || 'Agent'}</span>
                            <span className="font-mono text-[11px] text-dim">streaming</span>
                          </div>
                          <div className="whitespace-pre-wrap text-sm leading-6 text-muted">{streamingText}</div>
                        </div>
                      </div>
                    )}

                    {!sessionView.transcript.length && !streamingText && (
                      <div className="rounded-panel border border-dashed border-line p-4 text-sm text-muted">
                        Start the room with a repo-grounded prompt. The transcript stays secondary to the canvas but drives the current workflow.
                      </div>
                    )}
                  </div>
                )}
              </div>

              <form onSubmit={handleSend} className="border-t border-lineSubtle px-4 py-4">
                <div className="mb-3 flex items-center gap-2">
                  <select
                    value={selectedAgentId}
                    onChange={(event) => setSelectedAgentId(event.target.value)}
                    className="rounded-chip border border-line bg-panel px-3 py-2 text-sm text-ink outline-none transition focus:border-brand"
                  >
                    {(bootstrap?.agents || []).map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        New room host: {agent.name}
                      </option>
                    ))}
                  </select>
                  <div className="rounded-chip bg-panel px-3 py-2 text-xs text-muted">
                    Current room host: <span className="text-ink">{activeAgent?.name || 'Loading'}</span>
                  </div>
                </div>
                <div className="palpa-panel-raised rounded-panel p-3">
                  <textarea
                    value={composer}
                    onChange={(event) => setComposer(event.target.value)}
                    placeholder="Talk to the room. Use @agent in the message when you want explicit addressing later."
                    className="min-h-28 w-full resize-none bg-transparent text-sm leading-6 text-ink outline-none placeholder:text-dim"
                  />
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                      <span className="rounded-chip bg-panel px-2 py-1">@architect</span>
                      <span className="rounded-chip bg-panel px-2 py-1">@frontend</span>
                      <span className="rounded-chip bg-panel px-2 py-1">@orchestrator</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleInterrupt}
                        disabled={!sessionView.activeRunId}
                        className="rounded-chip bg-panel px-3 py-2 text-xs text-muted transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Interrupt
                      </button>
                      <button
                        type="submit"
                        disabled={sending || !composer.trim() || !activeSessionId}
                        className="rounded-chip bg-brand px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-[#6f5df7] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {sending ? 'Sending...' : 'Send to room'}
                      </button>
                    </div>
                  </div>
                </div>
                {error && <div className="mt-3 text-sm text-danger">{error}</div>}
              </form>
            </div>

            <div className="min-h-0">
              <div className="flex items-center justify-between gap-3 border-b border-lineSubtle px-4 py-3">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.08em] text-dim">Utility Pane</div>
                  <div className="mt-1 text-sm text-muted">Approvals, outputs, activity, files, and tools stay visible.</div>
                </div>
                <div className="rounded-chip bg-panel px-2 py-1 font-mono text-[11px] text-dim">
                  {sessions.length} rooms
                </div>
              </div>

              <div className="palpa-scrollbar h-full space-y-6 overflow-y-auto px-4 py-4">
                <div>
                  <div className="mb-3 text-[11px] uppercase tracking-[0.08em] text-dim">Approvals</div>
                  <div className="space-y-2">
                    {sessionView.approvals.length ? sessionView.approvals.map((approval) => (
                      <div key={approval.id} className="rounded-panel bg-panel p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm text-ink">{approval.kind}</span>
                          <span className={cx('font-mono text-[11px]', statusTone(approval.status))}>{approval.status}</span>
                        </div>
                        {approval.command.length ? (
                          <div className="mt-2 font-mono text-[11px] text-muted">{approval.command.join(' ')}</div>
                        ) : null}
                      </div>
                    )) : (
                      <div className="rounded-panel border border-dashed border-line p-3 text-sm text-muted">
                        No approval pressure yet.
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <div className="mb-3 text-[11px] uppercase tracking-[0.08em] text-dim">Draft And Promoted Queue</div>
                  <div className="space-y-2">
                    {[...sessionView.promotedArtifacts, ...sessionView.draftArtifacts].slice(0, 5).map((artifact) => (
                      <div key={artifact.id} className="rounded-panel bg-panel p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm text-ink">{artifact.title}</span>
                          <span className="font-mono text-[11px] text-dim">{artifact.kind}</span>
                        </div>
                        <div className="mt-1 text-xs leading-5 text-muted">{artifact.body}</div>
                      </div>
                    ))}
                    {!sessionView.draftArtifacts.length && !sessionView.promotedArtifacts.length && (
                      <div className="rounded-panel border border-dashed border-line p-3 text-sm text-muted">
                        Drafts and pinned outputs will queue here.
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <div className="mb-3 text-[11px] uppercase tracking-[0.08em] text-dim">Activity Snapshot</div>
                  <div className="space-y-2">
                    {sessionView.activities.slice(0, 5).map((activity) => (
                      <div key={activity.id} className="rounded-panel bg-panel p-3">
                        <div className="text-sm text-ink">{activity.label}</div>
                        <div className="mt-1 font-mono text-[11px] text-dim">{activity.type}</div>
                      </div>
                    ))}
                    {!sessionView.activities.length && (
                      <div className="rounded-panel border border-dashed border-line p-3 text-sm text-muted">
                        Waiting for runtime activity.
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <div className="mb-3 text-[11px] uppercase tracking-[0.08em] text-dim">Files Touched</div>
                    <div className="space-y-2">
                      {sessionView.files.length ? sessionView.files.map((file) => (
                        <div key={file.path} className="rounded-panel bg-panel p-3 font-mono text-[11px] text-muted">
                          {file.path}
                        </div>
                      )) : (
                        <div className="rounded-panel border border-dashed border-line p-3 text-sm text-muted">
                          No file changes yet.
                        </div>
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="mb-3 text-[11px] uppercase tracking-[0.08em] text-dim">Tools Used</div>
                    <div className="space-y-2">
                      {sessionView.tools.length ? sessionView.tools.map((tool) => (
                        <div key={tool.name} className="rounded-panel bg-panel p-3 font-mono text-[11px] text-muted">
                          {tool.name}
                        </div>
                      )) : (
                        <div className="rounded-panel border border-dashed border-line p-3 text-sm text-muted">
                          No tools used yet.
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div>
                  <div className="mb-3 text-[11px] uppercase tracking-[0.08em] text-dim">Rooms</div>
                  <div className="space-y-2">
                    {sessions.map((session) => (
                      <button
                        key={session.id}
                        type="button"
                        onClick={() => setActiveSessionId(session.id)}
                        className={cx(
                          'w-full rounded-panel p-3 text-left transition-colors',
                          session.id === activeSessionId ? 'bg-brandSoft text-brand' : 'bg-panel text-muted hover:text-ink'
                        )}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-sm font-medium">{session.title}</span>
                          <span className="font-mono text-[11px]">{session.id}</span>
                        </div>
                        <div className="mt-1 text-xs">
                          {session.agent?.name || session.metadata?.agentId || 'Agent host'}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
