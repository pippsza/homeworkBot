import { useEffect, useState } from "react";
import { RefreshCw, Loader2, ChevronRight } from "lucide-react";
import { useApi } from "../hooks/useApi";
import { useToast } from "../components/Toast";
import BackButton from "../components/BackButton";
import RoleGuard from "../components/RoleGuard";
import { SkeletonList } from "../components/Skeleton";
import ModelPicker from "../components/ModelPicker";

function ModelManagementContent() {
  const { apiFetch } = useApi();
  const { showToast } = useToast();
  const [catalog, setCatalog] = useState([]);
  const [roles, setRoles] = useState({});
  const [config, setConfig] = useState({});
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState(null);
  const [pickerState, setPickerState] = useState(null);

  const load = () => {
    setLoading(true);
    apiFetch("/models")
      .then((data) => {
        setCatalog(data.catalog || []);
        setRoles(data.roles || {});
        setConfig(data.config || {});
      })
      .catch((e) => {
        console.error("Models fetch error:", e);
        showToast("Ошибка загрузки моделей", "error");
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const syncModels = async () => {
    setSyncing(true);
    try {
      const result = await apiFetch("/models/sync", { method: "POST" });
      showToast(`Синхронизировано: ${result.synced?.google || 0} Google, ${result.synced?.openrouter || 0} OpenRouter`);
      load();
    } catch {
      showToast("Ошибка синхронизации", "error");
    }
    setSyncing(false);
  };

  const selectModel = async (role, provider, modelId, mode) => {
    setSaving(role);
    try {
      const currentConfig = config[role] || {};
      const body = mode === "fallback"
        ? {
            provider: currentConfig.provider || roles[role]?.default?.provider,
            modelId: currentConfig.modelId || roles[role]?.default?.modelId,
            fallbackProvider: provider,
            fallbackModelId: modelId,
          }
        : {
            provider,
            modelId,
            fallbackProvider: currentConfig.fallbackProvider,
            fallbackModelId: currentConfig.fallbackModelId,
          };

      await apiFetch(`/models/${role}`, { method: "PUT", body });
      setConfig((prev) => ({
        ...prev,
        [role]: mode === "fallback"
          ? { ...prev[role], fallbackProvider: provider, fallbackModelId: modelId }
          : { ...prev[role], provider, modelId },
      }));
      showToast("Модель обновлена");
    } catch {
      showToast("Ошибка сохранения", "error");
    }
    setSaving(null);
    setPickerState(null);
  };

  const getModelName = (provider, modelId) => {
    if (!provider || !modelId) return "Не выбрано";
    const model = catalog.find((m) => m.provider === provider && m.modelId === modelId);
    return model?.displayName || modelId;
  };

  const getProviderBadge = (provider) => {
    if (!provider) return null;
    return (
      <span
        className="text-[9px] font-bold uppercase px-1 py-0.5 rounded"
        style={{
          backgroundColor: provider === "google" ? "#4285f4" : "#6c5ce7",
          color: "#fff",
        }}
      >
        {provider === "google" ? "G" : "OR"}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="p-4">
        <BackButton to="/admin" />
        <h1 className="text-xl font-bold mb-4">AI модели</h1>
        <SkeletonList count={5} />
      </div>
    );
  }

  return (
    <div className="p-4 page-enter">
      <BackButton to="/admin" />

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">AI модели</h1>
        <button
          onClick={syncModels}
          disabled={syncing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
          style={{
            backgroundColor: "var(--tg-theme-button-color)",
            color: "var(--tg-theme-button-text-color)",
            opacity: syncing ? 0.6 : 1,
          }}
        >
          {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Синхронизация
        </button>
      </div>

      <p className="text-xs mb-4" style={{ color: "var(--tg-theme-hint-color)" }}>
        {catalog.length} моделей в каталоге. Нажмите на роль чтобы выбрать модель.
      </p>

      <div className="space-y-3">
        {Object.entries(roles).map(([roleKey, roleInfo]) => {
          const roleConfig = config[roleKey] || {};
          const primaryProvider = roleConfig.provider || roleInfo.default?.provider;
          const primaryModelId = roleConfig.modelId || roleInfo.default?.modelId;
          const isSaving = saving === roleKey;

          return (
            <div
              key={roleKey}
              className="card"
              style={{ cursor: "default", opacity: isSaving ? 0.6 : 1 }}
            >
              <div className="text-sm font-semibold mb-0.5">{roleInfo.label}</div>
              <div className="text-xs mb-2.5" style={{ color: "var(--tg-theme-hint-color)" }}>
                {roleInfo.description}
              </div>

              {/* Primary model */}
              <button
                onClick={() => setPickerState({ role: roleKey, mode: "primary" })}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg mb-1.5 text-left"
                style={{ backgroundColor: "var(--tg-theme-secondary-bg-color)" }}
              >
                {getProviderBadge(primaryProvider)}
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] font-medium" style={{ color: "var(--tg-theme-hint-color)" }}>
                    Primary
                  </div>
                  <div className="text-sm truncate">{getModelName(primaryProvider, primaryModelId)}</div>
                </div>
                <ChevronRight size={16} style={{ color: "var(--tg-theme-hint-color)" }} />
              </button>

              {/* Fallback model */}
              <button
                onClick={() => setPickerState({ role: roleKey, mode: "fallback" })}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left"
                style={{ backgroundColor: "var(--tg-theme-secondary-bg-color)" }}
              >
                {roleConfig.fallbackProvider
                  ? getProviderBadge(roleConfig.fallbackProvider)
                  : <span className="w-5" />}
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] font-medium" style={{ color: "var(--tg-theme-hint-color)" }}>
                    Fallback
                  </div>
                  <div className="text-sm truncate" style={{ opacity: roleConfig.fallbackModelId ? 1 : 0.5 }}>
                    {roleConfig.fallbackModelId
                      ? getModelName(roleConfig.fallbackProvider, roleConfig.fallbackModelId)
                      : "Не выбрано"}
                  </div>
                </div>
                <ChevronRight size={16} style={{ color: "var(--tg-theme-hint-color)" }} />
              </button>
            </div>
          );
        })}
      </div>

      {/* Model picker overlay */}
      {pickerState && (
        <ModelPicker
          catalog={catalog}
          title={`${roles[pickerState.role]?.label} — ${pickerState.mode === "primary" ? "Primary" : "Fallback"}`}
          selectedProvider={
            pickerState.mode === "primary"
              ? (config[pickerState.role]?.provider || roles[pickerState.role]?.default?.provider)
              : config[pickerState.role]?.fallbackProvider
          }
          selectedModelId={
            pickerState.mode === "primary"
              ? (config[pickerState.role]?.modelId || roles[pickerState.role]?.default?.modelId)
              : config[pickerState.role]?.fallbackModelId
          }
          onSelect={(provider, modelId) =>
            selectModel(pickerState.role, provider, modelId, pickerState.mode)
          }
          onClose={() => setPickerState(null)}
        />
      )}
    </div>
  );
}

export default function ModelManagement() {
  return (
    <RoleGuard
      role="superadmin"
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
