import { useState } from "react";
import FormField from "./FormField";
import FileUpload from "./FileUpload";

export default function TaskForm({ task, onSubmit, onCancel, loading }) {
  const [title, setTitle] = useState(task?.title || "");
  const [emoji, setEmoji] = useState(task?.emoji || "📄");
  const [description, setDescription] = useState(task?.description || "");
  const [attachments, setAttachments] = useState(task?.attachments || []);

  const handleSubmit = () => {
    if (!title.trim()) return;
    onSubmit({
      title: title.trim(),
      emoji: emoji.trim() || "📄",
      description: description.trim() || undefined,
      attachments,
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-3">
        <div className="w-16">
          <FormField label="Эмодзи" value={emoji} onChange={setEmoji} placeholder="📄" />
        </div>
        <div className="flex-1">
          <FormField label="Название" value={title} onChange={setTitle} placeholder="Задание 1" required />
        </div>
      </div>

      <FormField
        label="Описание"
        value={description}
        onChange={setDescription}
        placeholder="Описание задания..."
        multiline
      />

      <FileUpload attachments={attachments} onChange={setAttachments} />

      <div className="flex gap-2 pt-1">
        <button
          onClick={onCancel}
          className="flex-1 py-2.5 rounded-xl text-sm font-medium"
          style={{ backgroundColor: "var(--tg-theme-secondary-bg-color)" }}
        >
          Отмена
        </button>
        <button
          onClick={handleSubmit}
          disabled={!title.trim() || loading}
          className="flex-1 py-2.5 rounded-xl text-sm font-medium disabled:opacity-50"
          style={{
            backgroundColor: "var(--tg-theme-button-color)",
            color: "var(--tg-theme-button-text-color)",
          }}
        >
          {loading ? "..." : task ? "Сохранить" : "Создать"}
        </button>
      </div>
    </div>
  );
}
