import { useEffect, useState } from "react";
import { useApi } from "../hooks/useApi";
import BackButton from "../components/BackButton";
import RoleGuard from "../components/RoleGuard";
import { SkeletonList } from "../components/Skeleton";
import ConfirmDialog from "../components/ConfirmDialog";
import { useToast } from "../components/Toast";

function UserManagementContent() {
  const { apiFetch } = useApi();
  const { showToast } = useToast();
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [newUser, setNewUser] = useState("");
  const [addingRole, setAddingRole] = useState(null);
  const [confirmRemove, setConfirmRemove] = useState(null);

  const load = () => {
    apiFetch("/users/settings")
      .then(setSettings)
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const addUser = async (role) => {
    if (!newUser.startsWith("@")) return;
    try {
      const pathMap = { admins: "admins", reviewers: "reviewers", superusers: "superusers" };
      await apiFetch(`/users/${pathMap[role]}`, {
        method: "POST",
        body: { username: newUser },
      });
      setNewUser("");
      setAddingRole(null);
      showToast(`${newUser} добавлен`);
      load();
    } catch {
      showToast("Ошибка добавления", "error");
    }
  };

  const removeUser = async () => {
    if (!confirmRemove) return;
    const { role, username } = confirmRemove;
    try {
      const pathMap = { admins: "admins", reviewers: "reviewers", superusers: "superusers" };
      await apiFetch(`/users/${pathMap[role]}/${username.slice(1)}`, {
        method: "DELETE",
      });
      showToast(`${username} удален`);
      load();
    } catch {
      showToast("Ошибка удаления", "error");
    }
    setConfirmRemove(null);
  };

  if (loading) {
    return (
      <div className="p-4">
        <BackButton to="/admin" />
        <h1 className="text-xl font-bold mb-4">Пользователи</h1>
        <SkeletonList count={3} />
      </div>
    );
  }

  const sections = [
    { key: "admins", label: "Админы", desc: "Управление предметами, заданиями, информацией и ответами" },
    { key: "reviewers", label: "Ревьюверы", desc: "Просмотр ответов к заданиям и доступ к AI" },
    { key: "superusers", label: "Суперпользователи", desc: "Управление всеми ролями пользователей" },
  ];

  return (
    <div className="p-4 page-enter">
      <BackButton to="/admin" />
      <h1 className="text-xl font-bold mb-4">Пользователи</h1>

      {sections.map(({ key, label, desc }) => (
        <div key={key} className="mb-6">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-sm font-semibold text-[var(--tg-theme-hint-color)]">
              {label}
            </h2>
            <button
              onClick={() => setAddingRole(addingRole === key ? null : key)}
              className="text-xs font-medium"
              style={{ color: "var(--tg-theme-button-color)" }}
            >
              {addingRole === key ? "Отмена" : "+ Добавить"}
            </button>
          </div>

          <p className="text-xs text-[var(--tg-theme-hint-color)] mb-2">{desc}</p>

          {addingRole === key && (
            <div className="flex gap-2 mb-2">
              <input
                type="text"
                value={newUser}
                onChange={(e) => setNewUser(e.target.value)}
                placeholder="@username"
                className="flex-1 px-3 py-2.5 rounded-xl text-sm outline-none"
                style={{ backgroundColor: "var(--tg-theme-secondary-bg-color)" }}
              />
              <button
                onClick={() => addUser(key)}
                className="px-4 py-2.5 rounded-xl text-sm font-medium"
                style={{
                  backgroundColor: "var(--tg-theme-button-color)",
                  color: "var(--tg-theme-button-text-color)",
                }}
              >
                OK
              </button>
            </div>
          )}

          {settings[key]?.length === 0 ? (
            <p className="text-xs text-[var(--tg-theme-hint-color)] py-2">Пусто</p>
          ) : (
            settings[key].map((u) => (
              <div key={u} className="card flex items-center justify-between" style={{ cursor: "default" }}>
                <span className="text-sm">{u}</span>
                <button
                  onClick={() => setConfirmRemove({ role: key, username: u })}
                  className="text-red-500 text-xs font-medium"
                >
                  Удалить
                </button>
              </div>
            ))
          )}
        </div>
      ))}

      <ConfirmDialog
        open={!!confirmRemove}
        title="Удалить пользователя?"
        message={`${confirmRemove?.username} будет удален из роли`}
        onConfirm={removeUser}
        onCancel={() => setConfirmRemove(null)}
      />
    </div>
  );
}

export default function UserManagement() {
  return (
    <RoleGuard
      role="superuser"
      fallback={
        <div className="p-4 text-center text-[var(--tg-theme-hint-color)]">
          Нет доступа
        </div>
      }
    >
      <UserManagementContent />
    </RoleGuard>
  );
}
