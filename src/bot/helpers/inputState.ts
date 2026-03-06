export interface InputStateValue {
  [key: string]: any;
}

interface StateEntry {
  state: InputStateValue;
  timestamp: number;
}

const INPUT_STATE_TTL = 30 * 60 * 1000; // 30 minutes

const states = new Map<number, StateEntry>();

export function get(userId: number): InputStateValue | undefined {
  const entry = states.get(userId);
  if (!entry) return undefined;
  if (Date.now() - entry.timestamp > INPUT_STATE_TTL) {
    states.delete(userId);
    return undefined;
  }
  return entry.state;
}

export function set(userId: number, state: InputStateValue): void {
  states.set(userId, { state, timestamp: Date.now() });
}

export function del(userId: number): void {
  states.delete(userId);
}

// Periodic cleanup of expired entries
setInterval(() => {
  const now = Date.now();
  for (const [userId, entry] of Array.from(states)) {
    if (now - entry.timestamp > INPUT_STATE_TTL) {
      states.delete(userId);
    }
  }
}, 10 * 60 * 1000);

export { del as delete };
