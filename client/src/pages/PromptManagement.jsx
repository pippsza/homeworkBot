import { useEffect, useState } from "react";
import { RefreshCw, Save } from "lucide-react";
import { useApi } from "../hooks/useApi";
import { useToast } from "../components/Toast";
import BackButton from "../components/BackButton";
import RoleGuard from "../components/RoleGuard";
import { SkeletonList } from "../components/Skeleton";

function PromptManagementContent() {
  const { apiFetch } = useApi();
  const { showToast } = useToast();
  const [prompts, setPrompts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const load = () => {
    setLoading(true);
    apiFetch("/prompts")
      .then(setPrompts)
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const save = async (key) => {
    setSaving(true);
    try {
      await apiFetch(`/prompts/${key}`, {
        method: "PUT",
        body: { content: editContent },
      });
      showToast("Сохранено");
      setEditing(null);
      load();
    } catch {
      showToast("Ошибка сохранения", "error");
    }
    setSaving(false);
  };

  const sync = async () => {
    setSyncing(true);
    try {
      const result = await apiFetch("/prompts/sync", { method: "POST" });
      showToast(`Синхронизировано: ${result.synced}`);
      load();
    } catch {
      showToast("Ошибка синхронизации", "error");
    }
    setSyncing(false);
  };

  if (loading) {
    return (
      <div className="p-4">
        <BackButton to="/admin" />
        <h1 className="text-xl font-bold mb-4">Промпты</h1>
        <SkeletonList count={4} />
      </div>
    );
  }

  return (
    <div className="p-4 page-enter">
      <BackButton to="/admin" />

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">Промпты</h1>
        <button
          onClick={sync}
          disabled={syncing}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50"
          style={{
            backgroundColor: "var(--tg-theme-button-color)",
            color: "var(--tg-theme-button-text-color)",
          }}
        >
          <RefreshCw size={14} className={syncing ? "animate-spin" : ""} />
          Sync
        </button>
      </div>

      <div className="space-y-3">
        {prompts.map((p) => (
          <div key={p.key} className="card" style={{ cursor: "default" }}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-semibold">{p.key}</span>
              {p.updatedAt && (
                <span className="text-[10px] text-[var(--tg-theme-hint-color)]">
                  {new Date(p.updatedAt).toLocaleDateString()}
                </span>
              )}
            </div>
            {p.description && (
              <p className="text-xs text-[var(--tg-theme-hint-color)] mb-2">
                {p.description}
              </p>
            )}

            {editing === p.key ? (
              <div>
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  rows={8}
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none resize-y"
                  style={{ backgroundColor: "var(--tg-theme-secondary-bg-color)" }}
                />
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={() => save(p.key)}
                    disabled={saving}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50"
                    style={{
                      backgroundColor: "var(--tg-theme-button-color)",
                      color: "var(--tg-theme-button-text-color)",
                    }}
                  >
                    <Save size={12} />
                    {saving ? "..." : "Сохранить"}
                  </button>
                  <button
                    onClick={() => setEditing(null)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium"
                    style={{ color: "var(--tg-theme-hint-color)" }}
                  >
                    Отмена
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <pre
                  className="text-xs opacity-70 max-h-24 overflow-hidden"
                  style={{ fontFamily: "inherit", whiteSpace: "pre-wrap" }}
                >
                  {p.content}
                </pre>
                <button
                  onClick={() => {
                    setEditing(p.key);
                    setEditContent(p.content);
                  }}
                  className="mt-2 text-xs font-medium"
                  style={{ color: "var(--tg-theme-button-color)" }}
                >
                  Редактировать
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function PromptManagement() {
  return (
    <RoleGuard
      role="admin"
      fallback={
        <div className="p-4 text-center text-[var(--tg-theme-hint-color)]">
          Нет доступа
        </div>
      }
    >
      <PromptManagementContent />
    </RoleGuard>
  );
}
