import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Eye, Send } from "lucide-react";
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
  const [canViewAnswers, setCanViewAnswers] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sendingAns, setSendingAns] = useState(null);

  useEffect(() => {
    Promise.all([
      apiFetch(`/subjects/tasks/${taskId}`),
      apiFetch("/users/me"),
    ])
      .then(([taskData, user]) => {
        setData(taskData);
        setCanViewAnswers(user.isAnswerViewer);
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
        <div className="card mb-4 whitespace-pre-wrap" style={{ cursor: "default" }}>
          {task.description}
        </div>
      )}

      <AttachmentViewer attachments={task.attachments} />

      {canViewAnswers && task.answers?.length > 0 && !showAnswers && (
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
              {ans.type === "text" && <p className="whitespace-pre-wrap">{ans.content}</p>}
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
