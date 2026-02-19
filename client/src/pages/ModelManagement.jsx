import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { useApi } from "../hooks/useApi";
import { useToast } from "../components/Toast";
import BackButton from "../components/BackButton";
import RoleGuard from "../components/RoleGuard";
import { SkeletonList } from "../components/Skeleton";

function ModelManagementContent() {
  const { apiFetch } = useApi();
  const { showToast } = useToast();
  const [catalog, setCatalog] = useState({});
  const [tasks, setTasks] = useState({});
  const [current, setCurrent] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);
  const [error, setError] = useState(null);

  const load = () => {
    setLoading(true);
    setError(null);
    apiFetch("/models")
      .then((data) => {
        setCatalog(data.catalog || {});
        setTasks(data.tasks || {});
        setCurrent(data.current || {});
      })
      .catch((e) => {
        console.error("Models fetch error:", e);
        setError(e.message || "Ошибка загрузки");
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const selectModel = async (task, modelId) => {
    if (current[task] === modelId) return;
    setSaving(task);
    try {
      await apiFetch(`/models/${task}`, {
        method: "PUT",
        body: { modelId },
      });
      setCurrent((prev) => ({ ...prev, [task]: modelId }));
      showToast("Модель обновлена");
    } catch {
      showToast("Ошибка сохранения", "error");
    }
    setSaving(null);
  };

  if (loading) {
    return (
      <div className="p-4">
        <BackButton to="/admin" />
        <h1 className="text-xl font-bold mb-4">AI модели</h1>
        <SkeletonList count={3} />
      </div>
    );
  }

  return (
    <div className="p-4 page-enter">
      <BackButton to="/admin" />
      <h1 className="text-xl font-bold mb-4">AI модели</h1>

      {error && (
        <div
          className="mb-4 p-3 rounded-lg text-sm"
          style={{ backgroundColor: "#fee", color: "#c00" }}
        >
          {error}
        </div>
      )}

      <div className="space-y-4">
        {Object.entries(tasks).map(([taskKey, taskInfo]) => (
          <div key={taskKey} className="card" style={{ cursor: "default" }}>
            <div className="font-medium mb-2">{taskInfo.label}</div>

            <div className="space-y-1.5">
              {Object.entries(catalog).map(([modelId, modelInfo]) => {
                const isSelected = current[taskKey] === modelId;
                const isSaving = saving === taskKey;

                return (
                  <div
                    key={modelId}
                    onClick={() => !isSaving && selectModel(taskKey, modelId)}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-lg transition-colors"
                    style={{
                      backgroundColor: isSelected
                        ? "var(--tg-theme-button-color)"
                        : "var(--tg-theme-secondary-bg-color)",
                      color: isSelected
                        ? "var(--tg-theme-button-text-color)"
                        : "inherit",
                      opacity: isSaving ? 0.6 : 1,
                      cursor: isSaving ? "wait" : "pointer",
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">{modelInfo.name}</div>
                      <div
                        className="text-[11px]"
                        style={{
                          opacity: isSelected ? 0.85 : 0.6,
                        }}
                      >
                        {modelInfo.desc}
                      </div>
                    </div>
                    {isSelected &&
                      (isSaving ? (
                        <Loader2 size={16} className="animate-spin shrink-0" />
                      ) : (
                        <Check size={16} className="shrink-0" />
                      ))}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ModelManagement() {
  return (
    <RoleGuard
      role="admin"
      fallback={
        <div className="p-4 text-center text-[var(--tg-theme-hint-color)]">
          Нет доступа
        </div>
      }
    >
      <ModelManagementContent />
    </RoleGuard>
  );
}
