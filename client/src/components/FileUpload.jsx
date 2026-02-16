import { useRef, useState } from "react";
import { useApi } from "../hooks/useApi";
import { useToast } from "./Toast";

export default function FileUpload({ attachments, onChange }) {
  const { apiUpload } = useApi();
  const { showToast } = useToast();
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  const handleFiles = async (e) => {
    const files = Array.from(e.target.files);
    console.log("[FileUpload] selected files:", files.length, files.map(f => `${f.name} (${f.type}, ${f.size})`));
    if (!files.length) return;
    setUploading(true);
    const newAttachments = [...attachments];
    for (const file of files) {
      try {
        console.log("[FileUpload] uploading:", file.name);
        const result = await apiUpload(file);
        console.log("[FileUpload] uploaded OK:", file.name, "→", result);
        newAttachments.push({ ...result, name: file.name });
      } catch (err) {
        console.error("[FileUpload] upload FAILED:", file.name, err);
        showToast(err.message || "Ошибка загрузки", "error");
      }
    }
    onChange(newAttachments);
    setUploading(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  const remove = (index) => {
    onChange(attachments.filter((_, i) => i !== index));
  };

  return (
    <div>
      <label className="text-xs font-medium text-[var(--tg-theme-hint-color)] mb-1 block">
        Вложения
      </label>

      {attachments.length > 0 && (
        <div className="space-y-1.5 mb-2">
          {attachments.map((att, i) => (
            <div
              key={att.file_id || i}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm"
              style={{ backgroundColor: "var(--tg-theme-bg-color)" }}
            >
              <span>{att.type === "photo" ? "🖼" : "📎"}</span>
              <span className="flex-1 truncate">
                {att.name || (att.type === "photo" ? `Фото ${i + 1}` : `Документ ${i + 1}`)}
              </span>
              <button
                type="button"
                onClick={() => remove(i)}
                className="text-red-500 text-xs font-medium shrink-0"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        multiple
        onChange={handleFiles}
        className="hidden"
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="w-full py-2 rounded-xl text-sm font-medium disabled:opacity-50"
        style={{ backgroundColor: "var(--tg-theme-bg-color)" }}
      >
        {uploading ? "Загрузка..." : "+ Добавить файл"}
      </button>
    </div>
  );
}
