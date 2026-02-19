import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Eye, Send, Bot, Loader2, Download } from "lucide-react";
import { useApi } from "../hooks/useApi";
import { useToast } from "../components/Toast";
import BackButton from "../components/BackButton";
import AttachmentViewer from "../components/AttachmentViewer";
import { SkeletonDetail } from "../components/Skeleton";
import EmptyState from "../components/EmptyState";

export default function TaskDetail() {
  const { taskId } = useParams();
  const { apiFetch, apiSendToChat } = useApi();
  const { showToast } = useToast();
  const [data, setData] = useState(null);
  const [answers, setAnswers] = useState(null);
  const [showAnswers, setShowAnswers] = useState(false);
  const [canReview, setCanReview] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sendingAns, setSendingAns] = useState(null);

  useEffect(() => {
    Promise.all([
      apiFetch(`/subjects/tasks/${taskId}`),
      apiFetch("/users/me"),
    ])
      .then(([taskData, user]) => {
        setData(taskData);
        setCanReview(user.isReviewer);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [taskId]);

  const loadAnswers = async () => {
    try {
      const ans = await apiFetch(`/subjects/tasks/${taskId}/answers`);
      setAnswers(ans);
      setShowAnswers(true);
    } catch (e) {
      console.error("Cannot load answers:", e);
    }
  };

  if (loading) {
    return (
      <div className="p-4">
        <SkeletonDetail />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-4">
        <EmptyState emoji="🔍" title="Задание не найдено" />
      </div>
    );
  }

  const { subject, task } = data;

  const renderMarkdown = (text) => {
    let html = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    html = html.replace(
      /```[\w]*\n([\s\S]*?)```/g,
      '<pre style="background:var(--tg-theme-secondary-bg-color);padding:8px;border-radius:8px;overflow-x:auto;font-size:12px;margin:4px 0">$1</pre>'
    );
    html = html.replace(
      /`([^`]+)`/g,
      '<code style="background:var(--tg-theme-secondary-bg-color);padding:1px 4px;border-radius:4px;font-size:12px">$1</code>'
    );
    html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<em>$1</em>");
    html = html
      .split(/(<pre[\s\S]*?<\/pre>)/g)
      .map((part, i) => (i % 2 === 0 ? part.replace(/\n/g, "<br>") : part))
      .join("");
    return html;
  };

  const downloadAiFile = async (taskId, index, filename) => {
    try {
      const res = await fetch(`/api/subjects/tasks/${taskId}/ai-file/${index}`, {
        headers: {
          "x-telegram-init-data": window.Telegram?.WebApp?.initData || "",
          "ngrok-skip-browser-warning": "true",
        },
      });
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      showToast(e.message || "Ошибка скачивания", "error");
    }
  };

  return (
    <div className="p-4 page-enter">
      <BackButton to={`/subjects/${subject._id}`} />

      <div className="flex items-center gap-3 mb-2">
        <span className="text-3xl">{task.emoji || "📄"}</span>
        <h1 className="text-xl font-bold">{task.title}</h1>
      </div>

      <div className="text-xs text-[var(--tg-theme-hint-color)] mb-4">
        {subject.emoji} {subject.name}
      </div>

      {task.description && (
        <div className="card mb-4" style={{ cursor: "default", whiteSpace: "pre-wrap" }}>
          {task.description}
        </div>
      )}

      <AttachmentViewer attachments={task.attachments} />

      {/* AI Answer */}
      {task.aiAnswer && (
        <div className="card mt-4" style={{ cursor: "default" }}>
          <div className="flex items-center gap-1 text-xs text-[var(--tg-theme-hint-color)] mb-2">
            <Bot size={12} /> AI ответ
          </div>
          <div
            className="text-sm ai-answer-content"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(task.aiAnswer) }}
          />
          {task.aiAnswerFiles?.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3 pt-3" style={{ borderTop: "1px solid var(--tg-theme-secondary-bg-color)" }}>
              {task.aiAnswerFiles.map((f, i) => (
                <a
                  key={i}
                  href={`/api/subjects/tasks/${task._id}/ai-file/${i}?${new URLSearchParams({ "x-telegram-init-data": "" })}`}
                  onClick={(e) => {
                    e.preventDefault();
                    downloadAiFile(task._id, i, f.filename);
                  }}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium"
                  style={{
                    backgroundColor: "var(--tg-theme-button-color)",
                    color: "var(--tg-theme-button-text-color)",
                  }}
                >
                  <Download size={12} />
                  {f.filename}
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Auto-solve indicator */}
      {task.autoSolve && !task.aiAnswer && (
        <div className="card mt-4 flex items-center gap-2" style={{ cursor: "default" }}>
          <Loader2 size={14} className="animate-spin" style={{ color: "var(--tg-theme-button-color)" }} />
          <span className="text-sm text-[var(--tg-theme-hint-color)]">AI решает задание...</span>
        </div>
      )}

      {canReview && task.answers?.length > 0 && !showAnswers && (
        <button
          onClick={loadAnswers}
          className="mt-4 w-full py-3 rounded-xl font-medium text-sm"
          style={{
            backgroundColor: "var(--tg-theme-button-color)",
            color: "var(--tg-theme-button-text-color)",
          }}
        >
          <Eye size={16} className="inline mr-1" />Показать ответы ({task.answers.length})
        </button>
      )}

      {showAnswers && answers && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-[var(--tg-theme-hint-color)] mb-2">
            Ответы
          </h3>
          {answers.map((ans, i) => (
            <div key={ans._id || i} className="card mb-2" style={{ cursor: "default" }}>
              {ans.type === "text" && <p style={{ whiteSpace: "pre-wrap" }}>{ans.content}</p>}
              {ans.type === "photo" && (
                <div className="relative">
                  <img
                    src={`/api/attachments/${ans.file_id}`}
                    alt={`Ответ ${i + 1}`}
                    className="w-full rounded-lg"
                    loading="lazy"
                  />
                  <button
                    onClick={async () => {
                      setSendingAns(i);
                      try { await apiSendToChat(ans.file_id, "photo"); showToast("Отправлено в чат"); }
                      catch (e) { showToast(e.message || "Ошибка", "error"); }
                      setSendingAns(null);
                    }}
                    disabled={sendingAns === i}
                    className="absolute bottom-2 right-2 flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium backdrop-blur-sm disabled:opacity-50"
                    style={{ backgroundColor: "rgba(0,0,0,0.5)", color: "#fff" }}
                  >
                    <Send size={12} />{sendingAns === i ? "..." : "В чат"}
                  </button>
                </div>
              )}
              {ans.type === "document" && (
                <div className="flex items-center gap-2">
                  <span className="flex-1 text-sm">Документ {i + 1}</span>
                  <button
                    onClick={async () => {
                      setSendingAns(i);
                      try { await apiSendToChat(ans.file_id, "document"); showToast("Отправлено в чат"); }
                      catch (e) { showToast(e.message || "Ошибка", "error"); }
                      setSendingAns(null);
                    }}
                    disabled={sendingAns === i}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium shrink-0 disabled:opacity-50"
                    style={{ backgroundColor: "var(--tg-theme-button-color)", color: "var(--tg-theme-button-text-color)" }}
                  >
                    <Send size={12} />{sendingAns === i ? "..." : "В чат"}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
