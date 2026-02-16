import { useState } from "react";
import { Send, FileText, Image } from "lucide-react";
import { useApi } from "../hooks/useApi";
import { useToast } from "./Toast";

export default function AttachmentViewer({ attachments }) {
  const { apiSendToChat } = useApi();
  const { showToast } = useToast();
  const [sending, setSending] = useState(null);

  if (!attachments?.length) return null;

  const send = async (att, i) => {
    setSending(i);
    try {
      await apiSendToChat(att.file_id, att.type);
      showToast("Отправлено в чат");
    } catch (err) {
      showToast(err.message || "Ошибка отправки", "error");
    }
    setSending(null);
  };

  return (
    <div className="mt-3 space-y-2">
      <h3 className="text-sm font-semibold text-[var(--tg-theme-hint-color)]">
        Вложения ({attachments.length})
      </h3>
      {attachments.map((att, i) => (
        <div key={att._id || i}>
          {att.type === "photo" ? (
            <div className="relative">
              <img
                src={`/api/attachments/${att.file_id}`}
                alt={`Вложение ${i + 1}`}
                className="w-full rounded-lg"
                loading="lazy"
              />
              <button
                onClick={() => send(att, i)}
                disabled={sending === i}
                className="absolute bottom-2 right-2 flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium backdrop-blur-sm disabled:opacity-50"
                style={{
                  backgroundColor: "rgba(0,0,0,0.5)",
                  color: "#fff",
                }}
              >
                <Send size={12} />
                {sending === i ? "..." : "В чат"}
              </button>
            </div>
          ) : (
            <div
              className="card flex items-center gap-3"
              style={{ cursor: "default" }}
            >
              <FileText size={20} style={{ color: "var(--tg-theme-link-color)" }} />
              <span className="flex-1 truncate text-sm">
                Документ {i + 1}
              </span>
              <button
                onClick={() => send(att, i)}
                disabled={sending === i}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium shrink-0 disabled:opacity-50"
                style={{
                  backgroundColor: "var(--tg-theme-button-color)",
                  color: "var(--tg-theme-button-text-color)",
                }}
              >
                <Send size={12} />
                {sending === i ? "..." : "В чат"}
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
