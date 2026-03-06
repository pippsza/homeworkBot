/**
 * Media group collector for Telegram.
 * Telegram sends each photo/document in a media group as a separate message,
 * all sharing the same `media_group_id`. This module collects them into a
 * single batch before processing.
 */

export interface MediaItem {
  type: "photo" | "document";
  fileId: string;
  mimeType?: string;
  fileName?: string;
}

export interface MediaBatchResult {
  items: MediaItem[];
  caption: string;
}

interface PendingBatch {
  items: MediaItem[];
  caption: string;
  timer: ReturnType<typeof setTimeout>;
  resolve: (value: MediaBatchResult) => void;
}

const COLLECT_TIMEOUT_MS = 1500; // wait 1.5s after last item

const pending = new Map<string, PendingBatch>();

/**
 * Add an item to a media group batch.
 * Returns a promise that resolves with all collected items once the batch is complete.
 * Returns null for items that are not the "first" in their group (they join the existing batch).
 */
export function collect(
  mediaGroupId: string,
  item: MediaItem,
  caption?: string
): Promise<MediaBatchResult> | null {
  if (pending.has(mediaGroupId)) {
    const batch = pending.get(mediaGroupId)!;
    batch.items.push(item);
    if (caption && !batch.caption) batch.caption = caption;
    // Reset timer
    clearTimeout(batch.timer);
    batch.timer = setTimeout(() => flush(mediaGroupId), COLLECT_TIMEOUT_MS);
    return null; // not the first — caller should skip
  }

  // First item in this group
  let resolve: (value: MediaBatchResult) => void;
  const promise = new Promise<MediaBatchResult>((r) => {
    resolve = r;
  });
  const batch: PendingBatch = {
    items: [item],
    caption: caption || "",
    resolve: resolve!,
    timer: setTimeout(() => flush(mediaGroupId), COLLECT_TIMEOUT_MS),
  };
  pending.set(mediaGroupId, batch);
  return promise;
}

function flush(mediaGroupId: string): void {
  const batch = pending.get(mediaGroupId);
  if (!batch) return;
  pending.delete(mediaGroupId);
  clearTimeout(batch.timer);
  batch.resolve({ items: batch.items, caption: batch.caption });
}
