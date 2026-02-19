import { useTelegram } from "./useTelegram";

export function useApi() {
  const { initData } = useTelegram();

  async function apiFetch(path, options = {}) {
    const res = await fetch(`/api${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "x-telegram-init-data": initData,
        "ngrok-skip-browser-warning": "true",
        ...options.headers,
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Request failed" }));
      throw new Error(err.error || `API ${res.status}`);
    }
    return res.json();
  }

  async function apiUpload(file) {
    console.log("[apiUpload] start:", file.name, "type:", file.type, "size:", file.size);
    const formData = new FormData();
    formData.append("file", file);
    console.log("[apiUpload] sending to /api/attachments/upload, initData:", initData ? initData.slice(0, 30) + "..." : "MISSING");
    const res = await fetch("/api/attachments/upload", {
      method: "POST",
      headers: {
        "x-telegram-init-data": initData,
        "ngrok-skip-browser-warning": "true",
      },
      body: formData,
    });
    console.log("[apiUpload] response status:", res.status);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Upload failed" }));
      console.error("[apiUpload] ERROR:", res.status, err);
      throw new Error(err.error || `Upload ${res.status}`);
    }
    const result = await res.json();
    console.log("[apiUpload] OK:", result.type, result.file_id?.slice(0, 20) + "...");
    return result;
  }

  async function apiSendToChat(fileId, type) {
    return apiFetch(`/attachments/${fileId}/send`, {
      method: "POST",
      body: { type },
    });
  }

  return { apiFetch, apiUpload, apiSendToChat };
}
