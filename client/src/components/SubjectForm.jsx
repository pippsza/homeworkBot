import { useState } from "react";
import FormField from "./FormField";

export default function SubjectForm({ subject, onSubmit, onCancel, loading }) {
  const [name, setName] = useState(subject?.name || "");
  const [emoji, setEmoji] = useState(subject?.emoji || "📚");
  const [lecturerName, setLecturerName] = useState(subject?.lecturerName || "");
  const [lecturerContact, setLecturerContact] = useState(subject?.lecturerContact || "");
  const [practitionerName, setPractitionerName] = useState(subject?.practitionerName || "");
  const [practitionerContact, setPractitionerContact] = useState(subject?.practitionerContact || "");

  const handleSubmit = () => {
    if (!name.trim()) return;
    onSubmit({
      name: name.trim(),
      emoji: emoji.trim() || "📚",
      lecturerName: lecturerName.trim() || undefined,
      lecturerContact: lecturerContact.trim() || undefined,
      practitionerName: practitionerName.trim() || undefined,
      practitionerContact: practitionerContact.trim() || undefined,
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-3">
        <div className="w-16">
          <FormField label="Эмодзи" value={emoji} onChange={setEmoji} placeholder="📚" />
        </div>
        <div className="flex-1">
          <FormField label="Название" value={name} onChange={setName} placeholder="Математика" required />
        </div>
      </div>

      <FormField label="Лектор" value={lecturerName} onChange={setLecturerName} placeholder="Иванов И.И." />
      <FormField label="Контакт лектора" value={lecturerContact} onChange={setLecturerContact} placeholder="@ivanov" />
      <FormField label="Практик" value={practitionerName} onChange={setPractitionerName} placeholder="Петров П.П." />
      <FormField label="Контакт практика" value={practitionerContact} onChange={setPractitionerContact} placeholder="@petrov" />

      <p className="text-xs text-[var(--tg-theme-hint-color)]">
        Файлы можно добавить только через бота
      </p>

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
          disabled={!name.trim() || loading}
          className="flex-1 py-2.5 rounded-xl text-sm font-medium disabled:opacity-50"
          style={{
            backgroundColor: "var(--tg-theme-button-color)",
            color: "var(--tg-theme-button-text-color)",
          }}
        >
          {loading ? "..." : subject ? "Сохранить" : "Создать"}
        </button>
      </div>
    </div>
  );
}
