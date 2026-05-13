export function createEvent(type, sessionId, turnId, metadata = {}) {
  return {
    type,
    session_id: sessionId,
    turn_id: turnId,
    timestamp: new Date().toISOString(),
    ...metadata
  };
}
