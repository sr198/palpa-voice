import { approvalDecisionTypes, assertApprovalDecision, assertTypedInputArray } from './contracts.js';
import { createRuntimeId } from './ids.js';
import { EventFanout } from './stream.js';

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function resolveSessionStatusForEvent(currentStatus, event) {
  switch (event.type) {
    case 'session.updated':
      return event.status;
    case 'run.started':
      return 'running';
    case 'run.completed':
      if (event.status === 'failed') {
        return 'failed';
      }
      return 'completed';
    case 'approval.requested':
      return 'waiting_for_approval';
    case 'approval.resolved':
      return currentStatus === 'archived' ? currentStatus : 'running';
    case 'error':
      return 'failed';
    default:
      return currentStatus;
  }
}

function resolveRunStatusForEvent(currentStatus, event) {
  switch (event.type) {
    case 'run.started':
      return 'running';
    case 'run.completed':
      return event.status;
    case 'approval.requested':
      return 'waiting_for_approval';
    case 'approval.resolved':
      return currentStatus === 'interrupted' ? currentStatus : 'running';
    case 'error':
      return event.runId ? 'failed' : currentStatus;
    default:
      return currentStatus;
  }
}

export class SessionManager {
  constructor({
    provider,
    store,
    now = () => Date.now(),
    createId = createRuntimeId
  }) {
    if (!provider) {
      throw new Error('SessionManager requires a provider.');
    }

    if (!store) {
      throw new Error('SessionManager requires a store.');
    }

    this.provider = provider;
    this.store = store;
    this.now = now;
    this.createId = createId;
    this.fanoutBySession = new Map();
    this.consumePromise = null;
    this.running = false;
  }

  async initialize() {
    if (this.running) {
      return;
    }

    await this.provider.initialize();
    this.running = true;
    this.consumePromise = this.consumeProviderEvents();
  }

  async shutdown() {
    this.running = false;

    for (const fanout of this.fanoutBySession.values()) {
      fanout.close();
    }

    this.fanoutBySession.clear();
    await this.provider.shutdown();
    await this.consumePromise;
  }

  async createSession({ title = null, cwd = null, metadata = {}, providerSessionId = null } = {}) {
    const id = this.createId('session');
    const providerSession = await this.provider.createSession({
      title,
      cwd,
      metadata,
      providerSessionId
    });

    const timestamp = this.now();
    const session = {
      id,
      providerId: this.provider.id,
      title,
      cwd: providerSession.cwd ?? cwd,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: 'idle',
      binding: {
        providerSessionId: providerSession.providerSessionId,
        metadata: clone(providerSession.metadata || {})
      },
      metadata: clone(metadata)
    };

    await this.store.saveSession(session);
    await this.recordEvent(session.id, {
      type: 'session.created',
      sessionId: session.id
    });

    return session;
  }

  async bindSession({ providerSessionId, title = null, cwd = null, metadata = {} }) {
    const id = this.createId('session');
    const providerSession = await this.provider.bindSession({
      providerSessionId,
      title,
      cwd,
      metadata
    });

    const timestamp = this.now();
    const session = {
      id,
      providerId: this.provider.id,
      title,
      cwd: providerSession.cwd ?? cwd,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: 'idle',
      binding: {
        providerSessionId: providerSession.providerSessionId,
        metadata: clone(providerSession.metadata || {})
      },
      metadata: clone(metadata)
    };

    await this.store.saveSession(session);
    await this.recordEvent(session.id, {
      type: 'session.created',
      sessionId: session.id
    });

    return session;
  }

  async resumeSession(sessionId) {
    const session = await this.requireSession(sessionId);
    await this.provider.resumeSession({
      providerSessionId: session.binding.providerSessionId
    });
    return session;
  }

  async listSessions() {
    return this.store.listSessions();
  }

  async archiveSession(sessionId) {
    const session = await this.requireSession(sessionId);
    await this.provider.archiveSession({
      providerSessionId: session.binding.providerSessionId
    });

    const updated = {
      ...session,
      status: 'archived',
      updatedAt: this.now()
    };

    await this.store.saveSession(updated);
    await this.recordEvent(sessionId, {
      type: 'session.updated',
      sessionId,
      status: 'archived'
    });
  }

  async createRun({ sessionId, input, metadata = {} }) {
    assertTypedInputArray(input);

    const session = await this.requireSession(sessionId);
    const run = {
      id: this.createId('run'),
      sessionId,
      status: 'running',
      createdAt: this.now(),
      startedAt: this.now(),
      completedAt: null,
      metadata: clone(metadata)
    };

    await this.store.saveRun(run);
    const providerRun = await this.provider.createRun({
      sessionId,
      runId: run.id,
      providerSessionId: session.binding.providerSessionId,
      input,
      metadata
    });

    const persistedRun = {
      ...run,
      binding: {
        providerRunId: providerRun.providerRunId,
        metadata: clone(providerRun.metadata || {})
      }
    };

    await this.store.saveRun(persistedRun);

    await this.recordEvent(sessionId, {
      type: 'run.started',
      sessionId,
      runId: run.id
    });

    return clone(persistedRun);
  }

  async interruptRun(sessionId, runId) {
    const session = await this.requireSession(sessionId);
    const run = await this.requireRun(runId);
    await this.provider.interruptRun({
      sessionId,
      runId: run.binding?.providerRunId || runId,
      providerSessionId: session.binding.providerSessionId
    });
  }

  async respondToApproval(sessionId, runId, approvalId, decision) {
    assertApprovalDecision(decision);

    if (!approvalDecisionTypes.includes(decision.type)) {
      throw new Error('Approval decision type is invalid.');
    }

    const approval = await this.store.getApproval(approvalId);
    if (!approval || approval.sessionId !== sessionId || approval.runId !== runId) {
      throw new Error(`Unknown approval ${approvalId}.`);
    }

    await this.provider.respondToApproval({
      sessionId,
      runId,
      approvalId,
      decision
    });

    await this.store.resolveApproval(approvalId, {
      resolvedAt: this.now(),
      decision
    });

    await this.recordEvent(sessionId, {
      type: 'approval.resolved',
      sessionId,
      runId,
      approvalId,
      decision
    });
  }

  async *subscribe(sessionId, { cursor, signal } = {}) {
    await this.requireSession(sessionId);

    const replay = await this.store.listEvents(sessionId, { cursor });
    for (const entry of replay) {
      yield entry;
    }

    const fanout = this.getSessionFanout(sessionId);
    const stream = fanout.subscribe(signal);
    for await (const entry of stream) {
      yield entry;
    }
  }

  async getSessionHistory(sessionId, { cursor } = {}) {
    await this.requireSession(sessionId);
    return this.store.listEvents(sessionId, { cursor });
  }

  async consumeProviderEvents() {
    try {
      for await (const event of this.provider.stream()) {
        if (!this.running) {
          break;
        }

        const translated = await this.translateProviderEvent(event);
        if (!translated?.sessionId) {
          continue;
        }

        await this.recordEvent(translated.sessionId, translated);
      }
    } catch (error) {
      if (!this.running) {
        return;
      }

      throw error;
    }
  }

  async recordEvent(sessionId, event) {
    const session = await this.requireSession(sessionId);
    const updatedSession = {
      ...session,
      status: resolveSessionStatusForEvent(session.status, event),
      updatedAt: this.now()
    };

    await this.store.saveSession(updatedSession);

    if (event.runId) {
      const run = await this.store.getRun(event.runId);
      if (run) {
        const updatedRun = {
          ...run,
          status: resolveRunStatusForEvent(run.status, event),
          completedAt: event.type === 'run.completed' ? this.now() : run.completedAt
        };

        await this.store.saveRun(updatedRun);
      }
    }

    if (event.type === 'approval.requested') {
      await this.store.saveApproval({
        ...clone(event.approval),
        sessionId,
        runId: event.runId,
        requestedAt: this.now()
      });
    }

    const envelope = await this.store.appendEvent(sessionId, event);
    this.getSessionFanout(sessionId).push(envelope);
    return envelope;
  }

  async translateProviderEvent(event) {
    if (!event) {
      return null;
    }

    const sessions = await this.store.listSessions();
    const session = sessions.find((entry) => entry.binding?.providerSessionId === event.sessionId);
    if (!session) {
      return null;
    }

    let runtimeRunId = event.runId || null;
    if (event.runId) {
      const runs = await this.store.listRunsBySession(session.id);
      const run = runs.find((entry) => entry.binding?.providerRunId === event.runId || entry.id === event.runId);
      if (run) {
        runtimeRunId = run.id;
      }
    }

    return {
      ...event,
      sessionId: session.id,
      ...(runtimeRunId ? { runId: runtimeRunId } : {})
    };
  }

  getSessionFanout(sessionId) {
    let fanout = this.fanoutBySession.get(sessionId);
    if (!fanout) {
      fanout = new EventFanout();
      this.fanoutBySession.set(sessionId, fanout);
    }

    return fanout;
  }

  async requireSession(sessionId) {
    const session = await this.store.getSession(sessionId);
    if (!session) {
      throw new Error(`Unknown session ${sessionId}.`);
    }

    return session;
  }

  async requireRun(runId) {
    const run = await this.store.getRun(runId);
    if (!run) {
      throw new Error(`Unknown run ${runId}.`);
    }

    return run;
  }
}
