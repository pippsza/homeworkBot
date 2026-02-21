import { useEffect, useState } from "react";
import { useApi } from "../hooks/useApi";
import BackButton from "../components/BackButton";
import RoleGuard from "../components/RoleGuard";
import { SkeletonList } from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import ConfirmDialog from "../components/ConfirmDialog";
import InfoForm from "../components/InfoForm";
import { useToast } from "../components/Toast";

function InfoManagementContent() {
  const { apiFetch } = useApi();
  const { showToast } = useToast();
  const [infos, setInfos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const load = () => {
    apiFetch("/infos")
      .then(setInfos)
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const createInfo = async (data) => {
    setSaving(true);
    try {
      await apiFetch("/infos", { method: "POST", body: data });
      showToast("Информация создана");
      setShowForm(false);
      load();
    } catch {
      showToast("Ошибка создания", "error");
    }
    setSaving(false);
  };

  const updateInfo = async (data) => {
    setSaving(true);
    try {
      await apiFetch(`/infos/${editing._id}`, { method: "PUT", body: data });
      showToast("Информация обновлена");
      setEditing(null);
      load();
    } catch {
      showToast("Ошибка обновления", "error");
    }
    setSaving(false);
  };

  const deleteInfo = async () => {
    if (!confirmDelete) return;
    try {
      await apiFetch(`/infos/${confirmDelete._id}`, { method: "DELETE" });
      showToast("Информация удалена");
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
        <h1 className="text-xl font-bold mb-4">Управление информацией</h1>
        <SkeletonList count={4} />
      </div>
    );
  }

  if (showForm) {
    return (
      <div className="p-4 page-enter">
        <h1 className="text-xl font-bold mb-4">Новая информация</h1>
        <InfoForm onSubmit={createInfo} onCancel={() => setShowForm(false)} loading={saving} />
      </div>
    );
  }

  if (editing) {
    return (
      <div className="p-4 page-enter">
        <h1 className="text-xl font-bold mb-4">Редактирование</h1>
        <InfoForm info={editing} onSubmit={updateInfo} onCancel={() => setEditing(null)} loading={saving} />
      </div>
    );
  }

  return (
    <div className="p-4 page-enter">
      <BackButton to="/admin" />
      <h1 className="text-xl font-bold mb-4">Управление информацией</h1>

      {infos.length === 0 ? (
        <EmptyState
          emoji="ℹ️"
          title="Нет информации"
          description="Создайте первую запись"
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
            {infos.map((info) => (
              <div key={info._id} className="card" style={{ cursor: "default" }}>
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{info.emoji || "ℹ️"}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{info.title}</div>
                    {info.description && (
                      <div className="text-xs text-[var(--tg-theme-hint-color)] truncate">
                        {info.description.slice(0, 60)}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => setEditing(info)}
                      className="text-xs font-medium"
                      style={{ color: "var(--tg-theme-button-color)" }}
                    >
                      Изм.
                    </button>
                    <button
                      onClick={() => setConfirmDelete(info)}
                      className="text-xs font-medium text-red-500"
                    >
                      Удл.
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
            + Добавить информацию
          </button>
        </>
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        title="Удалить информацию?"
        message={`${confirmDelete?.emoji} ${confirmDelete?.title} будет удалена`}
        onConfirm={deleteInfo}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}

export default function InfoManagement() {
  return (
    <RoleGuard
      role="superadmin"
      fallback={<div className="p-4 text-center text-[var(--tg-theme-hint-color)]">Нет доступа</div>}
    >
      <InfoManagementContent />
    </RoleGuard>
  );
}
