/**
 * Media group collector for Telegram.
 * Telegram sends each photo/document in a media group as a separate message,
 * all sharing the same `media_group_id`. This module collects them into a
 * single batch before processing.
 */

const COLLECT_TIMEOUT_MS = 1500; // wait 1.5s after last item

// Map<mediaGroupId, { items: [], caption, timer, resolve, promise }>
const pending = new Map();

/**
 * Add an item to a media group batch.
 * Returns a promise that resolves with all collected items once the batch is complete.
 * Returns null for items that are not the "first" in their group (they join the existing batch).
 *
 * @param {string} mediaGroupId
 * @param {{ type: 'photo'|'document', fileId: string, mimeType?: string, fileName?: string }} item
 * @param {string} [caption] - only the first message in a group typically has a caption
 * @returns {Promise<{ items: Array, caption: string }> | null}
 */
function collect(mediaGroupId, item, caption) {
  if (pending.has(mediaGroupId)) {
    const batch = pending.get(mediaGroupId);
    batch.items.push(item);
    if (caption && !batch.caption) batch.caption = caption;
    // Reset timer
    clearTimeout(batch.timer);
    batch.timer = setTimeout(() => flush(mediaGroupId), COLLECT_TIMEOUT_MS);
    return null; // not the first — caller should skip
  }

  // First item in this group
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  const batch = {
    items: [item],
    caption: caption || "",
    resolve,
    timer: setTimeout(() => flush(mediaGroupId), COLLECT_TIMEOUT_MS),
  };
  pending.set(mediaGroupId, batch);
  return promise;
}

function flush(mediaGroupId) {
  const batch = pending.get(mediaGroupId);
  if (!batch) return;
  pending.delete(mediaGroupId);
  clearTimeout(batch.timer);
  batch.resolve({ items: batch.items, caption: batch.caption });
}

module.exports = { collect };
