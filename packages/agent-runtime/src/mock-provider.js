import { EventFanout } from './stream.js';

function toAsyncIterable(values) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const value of values) {
        yield value;
      }
    }
  };
}

export class MockAgentProvider {
  constructor({
    id = 'mock',
    capabilities = {
      supportsSessionBinding: true,
      supportsApprovals: true,
      supportsFileApprovals: true,
      supportsRunInterrupt: true
    },
    scriptFactory = null
  } = {}) {
    this.id = id;
    this.capabilities = capabilities;
    this.scriptFactory = scriptFactory;
    this.sessions = new Map();
    this.runs = new Map();
    this.responses = [];
    this.events = new EventFanout();
    this.initialized = false;
  }

  async initialize() {
    this.initialized = true;
  }

  async shutdown() {
    this.initialized = false;
    this.events.close();
  }

  async createSession(params) {
    const providerSessionId = params.providerSessionId || `provider_session_${this.sessions.size + 1}`;
    const session = {
      providerSessionId,
      title: params.title || null,
      cwd: params.cwd || null,
      metadata: params.metadata || {}
    };

    this.sessions.set(providerSessionId, session);
    return session;
  }

  async bindSession(params) {
    return this.createSession(params);
  }

  async resumeSession(params) {
    const session = this.sessions.get(params.providerSessionId);
    if (!session) {
      throw new Error(`Unknown provider session ${params.providerSessionId}.`);
    }

    return session;
  }

  async archiveSession(params) {
    const session = this.sessions.get(params.providerSessionId);
    if (!session) {
      throw new Error(`Unknown provider session ${params.providerSessionId}.`);
    }

    this.sessions.set(params.providerSessionId, {
      ...session,
      archived: true
    });
  }

  async listSessions() {
    return [...this.sessions.values()];
  }

  async createRun(params) {
    const run = {
      providerRunId: params.metadata?.providerRunId || `provider_run_${this.runs.size + 1}`,
      providerSessionId: params.providerSessionId,
      input: params.input
    };

    this.runs.set(run.providerRunId, run);

    if (this.scriptFactory) {
      const script = this.scriptFactory({
        ...params,
        providerRunId: run.providerRunId
      }) || [];
      queueMicrotask(async () => {
        const iterable = Symbol.asyncIterator in Object(script) ? script : toAsyncIterable(script);
        for await (const event of iterable) {
          this.emit(event);
        }
      });
    }

    return run;
  }

  async interruptRun(params) {
    this.emit({
      type: 'run.completed',
      sessionId: params.providerSessionId || params.sessionId,
      runId: params.runId,
      status: 'interrupted'
    });
  }

  async respondToApproval(params) {
    this.responses.push({
      sessionId: params.sessionId,
      runId: params.runId,
      approvalId: params.approvalId,
      decision: params.decision
    });
  }

  stream() {
    return this.events.subscribe();
  }

  emit(event) {
    this.events.push(event);
  }
}
