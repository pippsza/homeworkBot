import { useEffect, useState, useRef } from "react";
import { useParams } from "react-router-dom";
import { Upload, FileText, Trash2, Plus, Type } from "lucide-react";
import { useApi } from "../hooks/useApi";
import { useToast } from "../components/Toast";
import BackButton from "../components/BackButton";
import RoleGuard from "../components/RoleGuard";
import { SkeletonList } from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import ConfirmDialog from "../components/ConfirmDialog";

function KnowledgeContent() {
  const { id: subjectId } = useParams();
  const { apiFetch } = useApi();
  const { showToast } = useToast();
  const fileInputRef = useRef(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [showTextInput, setShowTextInput] = useState(false);
  const [textTitle, setTextTitle] = useState("");
  const [textContent, setTextContent] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [subject, setSubject] = useState(null);

  const load = async () => {
    try {
      const [kData, subj] = await Promise.all([
        apiFetch(`/knowledge/${subjectId}`),
        apiFetch(`/subjects/${subjectId}`),
      ]);
      setData(kData);
      setSubject(subj);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [subjectId]);

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const initData = window.Telegram?.WebApp?.initData;
      const res = await fetch(`/api/knowledge/${subjectId}/upload`, {
        method: "POST",
        headers: { "x-telegram-init-data": initData },
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Upload failed");
      }

      const result = await res.json();
      showToast(`Загружено: ${result.chunkCount} чанков`);
      load();
    } catch (e) {
      showToast(e.message || "Ошибка загрузки", "error");
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleTextSubmit = async () => {
    if (!textContent.trim()) return;
    setUploading(true);
    try {
      const result = await apiFetch(`/knowledge/${subjectId}/text`, {
        method: "POST",
        body: { text: textContent, title: textTitle || "Text input" },
      });
      showToast(`Загружено: ${result.chunkCount} чанков`);
      setShowTextInput(false);
      setTextTitle("");
      setTextContent("");
      load();
    } catch (e) {
      showToast(e.message || "Ошибка", "error");
    }
    setUploading(false);
  };

  const deleteDoc = async () => {
    if (!confirmDelete) return;
    try {
      await apiFetch(`/knowledge/${subjectId}/${confirmDelete._id}`, {
        method: "DELETE",
      });
      showToast("Документ удален");
      load();
    } catch {
      showToast("Ошибка удаления", "error");
    }
    setConfirmDelete(null);
  };

  if (loading) {
    return (
      <div className="p-4">
        <BackButton to="/admin/subjects" />
        <h1 className="text-xl font-bold mb-4">База знаний</h1>
        <SkeletonList count={3} />
      </div>
    );
  }

  const documents = data?.documents || [];
  const totalChunks = data?.totalChunks || 0;

  return (
    <div className="p-4 page-enter">
      <BackButton to="/admin/subjects" />

      <div className="flex items-center gap-2 mb-1">
        <span className="text-2xl">{subject?.emoji || "📚"}</span>
        <h1 className="text-xl font-bold">База знаний</h1>
      </div>
      <p className="text-xs text-[var(--tg-theme-hint-color)] mb-4">
        {subject?.name} — {totalChunks} чанков
      </p>

      {/* Upload buttons */}
      <div className="flex gap-2 mb-4">
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx,.doc,.txt,.png,.jpg,.jpeg"
          onChange={handleFileUpload}
          className="hidden"
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium disabled:opacity-50"
          style={{
            backgroundColor: "var(--tg-theme-button-color)",
            color: "var(--tg-theme-button-text-color)",
          }}
        >
          <Upload size={16} />
          {uploading ? "Загрузка..." : "Файл"}
        </button>
        <button
          onClick={() => setShowTextInput(!showTextInput)}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium"
          style={{
            backgroundColor: "var(--tg-theme-secondary-bg-color)",
          }}
        >
          <Type size={16} />
          Текст
        </button>
      </div>

      {/* Text input form */}
      {showTextInput && (
        <div className="card mb-4" style={{ cursor: "default" }}>
          <input
            type="text"
            value={textTitle}
            onChange={(e) => setTextTitle(e.target.value)}
            placeholder="Название (необязательно)"
            className="w-full px-3 py-2 rounded-lg text-sm outline-none mb-2"
            style={{ backgroundColor: "var(--tg-theme-secondary-bg-color)" }}
          />
          <textarea
            value={textContent}
            onChange={(e) => setTextContent(e.target.value)}
            placeholder="Вставьте текст для базы знаний..."
            rows={6}
            className="w-full px-3 py-2 rounded-lg text-sm outline-none resize-y mb-2"
            style={{ backgroundColor: "var(--tg-theme-secondary-bg-color)" }}
          />
          <div className="flex gap-2">
            <button
              onClick={handleTextSubmit}
              disabled={!textContent.trim() || uploading}
              className="flex-1 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
              style={{
                backgroundColor: "var(--tg-theme-button-color)",
                color: "var(--tg-theme-button-text-color)",
              }}
            >
              {uploading ? "Обработка..." : "Загрузить"}
            </button>
            <button
              onClick={() => { setShowTextInput(false); setTextContent(""); setTextTitle(""); }}
              className="px-4 py-2 rounded-lg text-sm"
              style={{ color: "var(--tg-theme-hint-color)" }}
            >
              Отмена
            </button>
          </div>
        </div>
      )}

      {/* Documents list */}
      {documents.length === 0 ? (
        <EmptyState
          emoji="📖"
          title="Нет документов"
          description="Загрузите файлы или текст для создания базы знаний"
        />
      ) : (
        <div className="space-y-2">
          {documents.map((doc) => (
            <div key={doc._id} className="card flex items-center gap-3" style={{ cursor: "default" }}>
              <FileText size={18} style={{ color: "var(--tg-theme-hint-color)" }} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{doc.filename}</div>
                <div className="text-xs text-[var(--tg-theme-hint-color)]">
                  {doc.chunkCount} чанков — {new Date(doc.createdAt).toLocaleDateString()}
                </div>
              </div>
              <button
                onClick={() => setConfirmDelete(doc)}
                className="text-red-500 shrink-0"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        title="Удалить документ?"
        message={`${confirmDelete?.filename} и все его чанки будут удалены`}
        onConfirm={deleteDoc}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}

export default function KnowledgeManagement() {
  return (
    <RoleGuard
      role="admin"
      fallback={<div className="p-4 text-center text-[var(--tg-theme-hint-color)]">Нет доступа</div>}
    >
      <KnowledgeContent />
    </RoleGuard>
  );
}
