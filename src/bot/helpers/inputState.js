const INPUT_STATE_TTL = 30 * 60 * 1000; // 30 minutes

const states = new Map();

function get(userId) {
  const entry = states.get(userId);
  if (!entry) return undefined;
  if (Date.now() - entry.timestamp > INPUT_STATE_TTL) {
    states.delete(userId);
    return undefined;
  }
  return entry.state;
}

function set(userId, state) {
  states.set(userId, { state, timestamp: Date.now() });
}

function del(userId) {
  states.delete(userId);
}

// Periodic cleanup of expired entries
setInterval(() => {
  const now = Date.now();
  for (const [userId, entry] of states) {
    if (now - entry.timestamp > INPUT_STATE_TTL) {
      states.delete(userId);
    }
  }
}, 10 * 60 * 1000);

module.exports = { get, set, delete: del };
