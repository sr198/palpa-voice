function clone(value) {
  return value == null ? value : structuredClone(value);
}

export class InMemoryRuntimeStore {
  constructor() {
    this.sessions = new Map();
    this.runs = new Map();
    this.eventsBySession = new Map();
    this.approvals = new Map();
    this.eventSequence = 0;
  }

  async saveSession(session) {
    this.sessions.set(session.id, clone(session));
  }

  async getSession(sessionId) {
    return clone(this.sessions.get(sessionId) || null);
  }

  async listSessions() {
    return [...this.sessions.values()].map((session) => clone(session));
  }

  async saveRun(run) {
    this.runs.set(run.id, clone(run));
  }

  async getRun(runId) {
    return clone(this.runs.get(runId) || null);
  }

  async listRunsBySession(sessionId) {
    return [...this.runs.values()]
      .filter((run) => run.sessionId === sessionId)
      .map((run) => clone(run));
  }

  async appendEvent(sessionId, event) {
    const cursor = String(++this.eventSequence);
    const envelope = {
      cursor,
      timestamp: Date.now(),
      sessionId,
      event: clone(event)
    };

    const entries = this.eventsBySession.get(sessionId) || [];
    entries.push(envelope);
    this.eventsBySession.set(sessionId, entries);
    return clone(envelope);
  }

  async listEvents(sessionId, { cursor } = {}) {
    const entries = this.eventsBySession.get(sessionId) || [];
    if (!cursor) {
      return entries.map((entry) => clone(entry));
    }

    const index = entries.findIndex((entry) => entry.cursor === cursor);
    if (index === -1) {
      return entries.map((entry) => clone(entry));
    }

    return entries.slice(index + 1).map((entry) => clone(entry));
  }

  async saveApproval(approval) {
    this.approvals.set(approval.id, clone(approval));
  }

  async getApproval(approvalId) {
    return clone(this.approvals.get(approvalId) || null);
  }

  async resolveApproval(approvalId, resolution) {
    const approval = this.approvals.get(approvalId);
    if (!approval) {
      return null;
    }

    const updated = {
      ...approval,
      resolvedAt: resolution.resolvedAt,
      decision: clone(resolution.decision)
    };

    this.approvals.set(approvalId, updated);
    return clone(updated);
  }
}
