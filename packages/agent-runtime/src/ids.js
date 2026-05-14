import { randomUUID } from 'node:crypto';

export function createRuntimeId(prefix) {
  return `${prefix}_${randomUUID()}`;
}
