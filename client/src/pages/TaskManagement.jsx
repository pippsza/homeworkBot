import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Pencil, Trash2, Plus, Bot, Loader2 } from "lucide-react";
import { useApi } from "../hooks/useApi";
import BackButton from "../components/BackButton";
import RoleGuard from "../components/RoleGuard";
import { SkeletonList } from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import ConfirmDialog from "../components/ConfirmDialog";
import TaskForm from "../components/TaskForm";
import AttachmentViewer from "../components/AttachmentViewer";
import FileUpload from "../components/FileUpload";
import { useToast } from "../components/Toast";

function TaskManagementContent() {
  const { id: subjectId } = useParams();
  const { apiFetch, apiSendToChat } = useApi();
  const { showToast } = useToast();
  const [subject, setSubject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [expandedTask, setExpandedTask] = useState(null);
  const [newAnswer, setNewAnswer] = useState("");
  const [answerFiles, setAnswerFiles] = useState([]);
  const [addingAnswer, setAddingAnswer] = useState(null);
  const [solving, setSolving] = useState(null);

  const load = () => {
    apiFetch(`/subjects/${subjectId}`)
      .then(setSubject)
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(load, [subjectId]);

  const createTask = async (data) => {
    setSaving(true);
    try {
      await apiFetch(`/subjects/${subjectId}/tasks`, { method: "POST", body: data });
      showToast("Задание создано");
      setShowForm(false);
      load();
    } catch {
      showToast("Ошибка создания", "error");
    }
    setSaving(false);
  };

  const updateTask = async (data) => {
    setSaving(true);
    try {
      await apiFetch(`/subjects/tasks/${editing._id}`, { method: "PUT", body: data });
      showToast("Задание обновлено");
      setEditing(null);
      load();
    } catch {
      showToast("Ошибка обновления", "error");
    }
    setSaving(false);
  };

  const deleteTask = async () => {
    if (!confirmDelete) return;
    try {
      await apiFetch(`/subjects/tasks/${confirmDelete._id}`, { method: "DELETE" });
      showToast("Задание удалено");
      load();
    } catch {
      showToast("Ошибка удаления", "error");
    }
    setConfirmDelete(null);
  };

  const submitAnswer = async (taskId) => {
    const hasText = newAnswer.trim();
    const hasFiles = answerFiles.length > 0;
    if (!hasText && !hasFiles) return;
    try {
      if (hasText) {
        await apiFetch(`/subjects/tasks/${taskId}/answers`, {
          method: "POST",
          body: { type: "text", content: newAnswer.trim() },
        });
      }
      for (const file of answerFiles) {
        await apiFetch(`/subjects/tasks/${taskId}/answers`, {
          method: "POST",
          body: { type: file.type, file_id: file.file_id },
        });
      }
      showToast("Ответ добавлен");
      setNewAnswer("");
      setAnswerFiles([]);
      setAddingAnswer(null);
      load();
    } catch {
      showToast("Ошибка добавления", "error");
    }
  };

  const solveWithAI = async (taskId) => {
    setSolving(taskId);
    try {
      await apiFetch(`/subjects/tasks/${taskId}/solve`, { method: "POST" });
      showToast("AI решил задание");
      load();
    } catch (e) {
      showToast(e.message || "Ошибка AI", "error");
    }
    setSolving(null);
  };

  if (loading) {
    return (
      <div className="p-4">
        <BackButton to="/admin/subjects" />
        <SkeletonList count={4} />
      </div>
    );
  }

  if (!subject) {
    return (
      <div className="p-4">
        <BackButton to="/admin/subjects" />
        <EmptyState emoji="🔍" title="Предмет не найден" />
      </div>
    );
  }

  if (showForm) {
    return (
      <div className="p-4 page-enter">
        <h1 className="text-xl font-bold mb-4">Новое задание</h1>
        <TaskForm onSubmit={createTask} onCancel={() => setShowForm(false)} loading={saving} />
      </div>
    );
  }

  if (editing) {
    return (
      <div className="p-4 page-enter">
        <h1 className="text-xl font-bold mb-4">Редактирование</h1>
        <TaskForm task={editing} onSubmit={updateTask} onCancel={() => setEditing(null)} loading={saving} />
      </div>
    );
  }

  const tasks = subject.tasks || [];

  return (
    <div className="p-4 page-enter">
      <BackButton to="/admin/subjects" />
      <div className="flex items-center gap-2 mb-4">
        <span className="text-2xl">{subject.emoji || "📚"}</span>
        <h1 className="text-xl font-bold">{subject.name}</h1>
      </div>

      <h2 className="text-sm font-semibold text-[var(--tg-theme-hint-color)] mb-2">
        Задания
      </h2>

      {tasks.length === 0 ? (
        <EmptyState
          emoji="📝"
          title="Нет заданий"
          description="Создайте первое задание"
          action={
            <button
              onClick={() => setShowForm(true)}
              className="px-6 py-2.5 rounded-xl text-sm font-medium"
              style={{
                backgroundColor: "var(--tg-theme-button-color)",
                color: "var(--tg-theme-button-text-color)",
              }}
            >
              + Добавить
            </button>
          }
        />
      ) : (
        <>
          <div className="space-y-2 mb-4">
            {tasks.map((t) => (
              <div key={t._id} className="card" style={{ cursor: "default" }}>
                <div className="flex items-center gap-3">
                  <span
                    className="text-xl cursor-pointer"
                    onClick={() => setExpandedTask(expandedTask === t._id ? null : t._id)}
                  >
                    {t.emoji || "📄"}
                  </span>
                  <div
                    className="flex-1 min-w-0 cursor-pointer"
                    onClick={() => setExpandedTask(expandedTask === t._id ? null : t._id)}
                  >
                    <div className="font-medium truncate">{t.title}</div>
                    <div className="flex gap-2 text-xs text-[var(--tg-theme-hint-color)]">
                      {t.attachments?.length > 0 && <span>📎{t.attachments.length}</span>}
                      {t.answers?.length > 0 && <span>💬{t.answers.length}</span>}
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => setEditing(t)}
                      className="text-xs font-medium"
                      style={{ color: "var(--tg-theme-button-color)" }}
                    >
                      Изм.
                    </button>
                    <button
                      onClick={() => setConfirmDelete(t)}
                      className="text-xs font-medium text-red-500"
                    >
                      Удл.
                    </button>
                  </div>
                </div>

                {expandedTask === t._id && (
                  <div className="mt-3 pt-3 border-t border-[var(--tg-theme-hint-color)]/20 space-y-3">
                    {t.description && (
                      <p className="text-sm whitespace-pre-wrap">{t.description}</p>
                    )}

                    {t.attachments?.length > 0 && (
                      <AttachmentViewer attachments={t.attachments} />
                    )}

                    {t.answers?.length > 0 && (
                      <div>
                        <p className="text-xs text-[var(--tg-theme-hint-color)] mb-1">
                          Ответы ({t.answers.length})
                        </p>
                        {t.answers.map((ans, i) => (
                          <div key={ans._id || i} className="text-sm py-1">
                            {ans.type === "text" && <span>{ans.content}</span>}
                            {ans.type === "photo" && (
                              <img
                                src={`/api/attachments/${ans.file_id}`}
                                className="w-full rounded-lg mt-1"
                                loading="lazy"
                              />
                            )}
                            {ans.type === "document" && (
                              <button
                                onClick={async () => {
                                  try { await apiSendToChat(ans.file_id, "document"); showToast("Отправлено в чат"); }
                                  catch (e) { showToast(e.message || "Ошибка", "error"); }
                                }}
                                className="text-sm"
                                style={{ color: "var(--tg-theme-link-color)" }}
                              >
                                Документ {i + 1} — отправить в чат
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* AI Answer */}
                    {t.aiAnswer && (
                      <div className="p-2 rounded-lg" style={{ backgroundColor: "var(--tg-theme-secondary-bg-color)" }}>
                        <div className="flex items-center gap-1 text-xs text-[var(--tg-theme-hint-color)] mb-1">
                          <Bot size={12} /> AI ответ
                        </div>
                        <p className="text-sm whitespace-pre-wrap">{t.aiAnswer}</p>
                      </div>
                    )}

                    {/* Solve with AI button */}
                    <button
                      onClick={() => solveWithAI(t._id)}
                      disabled={solving === t._id}
                      className="flex items-center gap-1 text-xs font-medium disabled:opacity-50"
                      style={{ color: "var(--tg-theme-button-color)" }}
                    >
                      {solving === t._id ? (
                        <><Loader2 size={12} className="animate-spin" /> AI решает...</>
                      ) : (
                        <><Bot size={12} /> {t.aiAnswer ? "Перерешить с AI" : "Решить с AI"}</>
                      )}
                    </button>

                    {addingAnswer === t._id ? (
                      <div className="space-y-2">
                        <textarea
                          value={newAnswer}
                          onChange={(e) => setNewAnswer(e.target.value)}
                          placeholder="Текст ответа..."
                          rows={2}
                          className="w-full rounded-xl px-3 py-2.5 text-sm outline-none resize-none"
                          style={{ backgroundColor: "var(--tg-theme-bg-color)" }}
                        />
                        <FileUpload attachments={answerFiles} onChange={setAnswerFiles} />
                        <div className="flex gap-2">
                          <button
                            onClick={() => { setAddingAnswer(null); setNewAnswer(""); setAnswerFiles([]); }}
                            className="flex-1 py-2 rounded-xl text-xs font-medium"
                            style={{ backgroundColor: "var(--tg-theme-bg-color)" }}
                          >
                            Отмена
                          </button>
                          <button
                            onClick={() => submitAnswer(t._id)}
                            disabled={!newAnswer.trim() && !answerFiles.length}
                            className="flex-1 py-2 rounded-xl text-xs font-medium disabled:opacity-50"
                            style={{
                              backgroundColor: "var(--tg-theme-button-color)",
                              color: "var(--tg-theme-button-text-color)",
                            }}
                          >
                            Добавить
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => setAddingAnswer(t._id)}
                        className="text-xs font-medium"
                        style={{ color: "var(--tg-theme-button-color)" }}
                      >
                        + Добавить ответ
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          <button
            onClick={() => setShowForm(true)}
            className="w-full py-3 rounded-xl text-sm font-medium"
            style={{
              backgroundColor: "var(--tg-theme-button-color)",
              color: "var(--tg-theme-button-text-color)",
            }}
          >
            + Добавить задание
          </button>
        </>
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        title="Удалить задание?"
        message={`${confirmDelete?.emoji} ${confirmDelete?.title} будет удалено`}
        onConfirm={deleteTask}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}

export default function TaskManagement() {
  return (
    <RoleGuard
      role="admin"
      fallback={<div className="p-4 text-center text-[var(--tg-theme-hint-color)]">Нет доступа</div>}
    >
      <TaskManagementContent />
    </RoleGuard>
  );
}
