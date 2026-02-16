import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Pencil, Trash2, Plus } from "lucide-react";
import { useApi } from "../hooks/useApi";
import BackButton from "../components/BackButton";
import RoleGuard from "../components/RoleGuard";
import { SkeletonList } from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import ConfirmDialog from "../components/ConfirmDialog";
import SubjectForm from "../components/SubjectForm";
import { useToast } from "../components/Toast";

function SubjectManagementContent() {
  const { apiFetch } = useApi();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [subjects, setSubjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const load = () => {
    apiFetch("/subjects")
      .then(setSubjects)
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const createSubject = async (data) => {
    setSaving(true);
    try {
      await apiFetch("/subjects", { method: "POST", body: data });
      showToast("Предмет создан");
      setShowForm(false);
      load();
    } catch {
      showToast("Ошибка создания", "error");
    }
    setSaving(false);
  };

  const updateSubject = async (data) => {
    setSaving(true);
    try {
      await apiFetch(`/subjects/${editing._id}`, { method: "PUT", body: data });
      showToast("Предмет обновлен");
      setEditing(null);
      load();
    } catch {
      showToast("Ошибка обновления", "error");
    }
    setSaving(false);
  };

  const deleteSubject = async () => {
    if (!confirmDelete) return;
    try {
      await apiFetch(`/subjects/${confirmDelete._id}`, { method: "DELETE" });
      showToast("Предмет удален");
      load();
    } catch {
      showToast("Ошибка удаления", "error");
    }
    setConfirmDelete(null);
  };

  if (loading) {
    return (
      <div className="p-4">
        <BackButton to="/admin" />
        <h1 className="text-xl font-bold mb-4">Управление предметами</h1>
        <SkeletonList count={4} />
      </div>
    );
  }

  if (showForm) {
    return (
      <div className="p-4 page-enter">
        <h1 className="text-xl font-bold mb-4">Новый предмет</h1>
        <SubjectForm onSubmit={createSubject} onCancel={() => setShowForm(false)} loading={saving} />
      </div>
    );
  }

  if (editing) {
    return (
      <div className="p-4 page-enter">
        <h1 className="text-xl font-bold mb-4">Редактирование</h1>
        <SubjectForm subject={editing} onSubmit={updateSubject} onCancel={() => setEditing(null)} loading={saving} />
      </div>
    );
  }

  return (
    <div className="p-4 page-enter">
      <BackButton to="/admin" />
      <h1 className="text-xl font-bold mb-4">Управление предметами</h1>

      {subjects.length === 0 ? (
        <EmptyState
          emoji="📚"
          title="Нет предметов"
          description="Создайте первый предмет"
          action={
            <button
              onClick={() => setShowForm(true)}
              className="px-6 py-2.5 rounded-xl text-sm font-medium"
              style={{
                backgroundColor: "var(--tg-theme-button-color)",
                color: "var(--tg-theme-button-text-color)",
              }}
            >
              <Plus size={16} className="inline" /> Добавить
            </button>
          }
        />
      ) : (
        <>
          <div className="space-y-2 mb-4">
            {subjects.map((s) => (
              <div key={s._id} className="card" style={{ cursor: "default" }}>
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{s.emoji || "📚"}</span>
                  <div
                    className="flex-1 min-w-0 cursor-pointer"
                    onClick={() => navigate(`/admin/subjects/${s._id}/tasks`)}
                  >
                    <div className="font-medium truncate">{s.name}</div>
                    <div className="text-xs text-[var(--tg-theme-hint-color)]">
                      {s.tasks?.length || 0} заданий
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => setEditing(s)}
                      className="text-xs font-medium"
                      style={{ color: "var(--tg-theme-button-color)" }}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => setConfirmDelete(s)}
                      className="text-xs font-medium text-red-500"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
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
            <Plus size={16} className="inline" /> Добавить предмет
          </button>
        </>
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        title="Удалить предмет?"
        message={`${confirmDelete?.emoji} ${confirmDelete?.name} и все задания будут удалены`}
        onConfirm={deleteSubject}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}

export default function SubjectManagement() {
  return (
    <RoleGuard
      role="admin"
      fallback={<div className="p-4 text-center text-[var(--tg-theme-hint-color)]">Нет доступа</div>}
    >
      <SubjectManagementContent />
    </RoleGuard>
  );
}
