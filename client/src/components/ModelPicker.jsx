import { useState, useMemo } from "react";
import { Search, X, Eye, Wrench, Brain, Check } from "lucide-react";

const FILTERS = [
  { key: "google", label: "Google" },
  { key: "openrouter", label: "OpenRouter" },
  { key: "vision", label: "Vision", icon: Eye },
  { key: "tools", label: "Tools", icon: Wrench },
  { key: "reasoning", label: "Reasoning", icon: Brain },
  { key: "free", label: "Free" },
];

function formatPrice(price) {
  if (!price || price === 0) return "Free";
  if (price < 0.01) return `$${price.toFixed(4)}`;
  return `$${price.toFixed(2)}`;
}

export default function ModelPicker({ catalog, onSelect, onClose, selectedProvider, selectedModelId, title }) {
  const [search, setSearch] = useState("");
  const [activeFilters, setActiveFilters] = useState(new Set());

  const toggleFilter = (key) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const filtered = useMemo(() => {
    let items = catalog || [];

    // Text search
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter(
        (m) =>
          m.displayName.toLowerCase().includes(q) ||
          m.modelId.toLowerCase().includes(q)
      );
    }

    // Provider filters
    if (activeFilters.has("google") && !activeFilters.has("openrouter")) {
      items = items.filter((m) => m.provider === "google");
    } else if (activeFilters.has("openrouter") && !activeFilters.has("google")) {
      items = items.filter((m) => m.provider === "openrouter");
    }

    // Capability filters
    if (activeFilters.has("vision")) items = items.filter((m) => m.supportsVision);
    if (activeFilters.has("tools")) items = items.filter((m) => m.supportsToolCalling);
    if (activeFilters.has("reasoning")) items = items.filter((m) => m.supportsReasoning);
    if (activeFilters.has("free")) items = items.filter((m) => m.isFree);

    return items;
  }, [catalog, search, activeFilters]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ backgroundColor: "var(--tg-theme-bg-color)" }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b" style={{ borderColor: "var(--tg-theme-secondary-bg-color)" }}>
        <button onClick={onClose} className="p-1">
          <X size={20} />
        </button>
        <h2 className="text-base font-semibold flex-1">{title || "Выбор модели"}</h2>
        <span className="text-xs" style={{ color: "var(--tg-theme-hint-color)" }}>
          {filtered.length} моделей
        </span>
      </div>

      {/* Search */}
      <div className="px-4 py-2">
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-xl"
          style={{ backgroundColor: "var(--tg-theme-secondary-bg-color)" }}
        >
          <Search size={16} style={{ color: "var(--tg-theme-hint-color)" }} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск модели..."
            className="flex-1 bg-transparent outline-none text-sm"
          />
          {search && (
            <button onClick={() => setSearch("")} className="p-0.5">
              <X size={14} style={{ color: "var(--tg-theme-hint-color)" }} />
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="px-4 pb-2 flex gap-1.5 flex-wrap">
        {FILTERS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => toggleFilter(key)}
            className="px-2.5 py-1 rounded-full text-xs font-medium transition-colors"
            style={{
              backgroundColor: activeFilters.has(key)
                ? "var(--tg-theme-button-color)"
                : "var(--tg-theme-secondary-bg-color)",
              color: activeFilters.has(key)
                ? "var(--tg-theme-button-text-color)"
                : "inherit",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Model list */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {filtered.length === 0 ? (
          <div
            className="text-center py-8 text-sm"
            style={{ color: "var(--tg-theme-hint-color)" }}
          >
            Модели не найдены
          </div>
        ) : (
          <div className="space-y-1">
            {filtered.map((model) => {
              const isSelected =
                model.provider === selectedProvider &&
                model.modelId === selectedModelId;

              return (
                <button
                  key={`${model.provider}:${model.modelId}`}
                  onClick={() => onSelect(model.provider, model.modelId, model.displayName)}
                  className="w-full text-left flex items-center gap-2.5 px-3 py-2.5 rounded-xl transition-colors"
                  style={{
                    backgroundColor: isSelected
                      ? "var(--tg-theme-button-color)"
                      : "var(--tg-theme-secondary-bg-color)",
                    color: isSelected
                      ? "var(--tg-theme-button-text-color)"
                      : "inherit",
                  }}
                >
                  {/* Provider badge */}
                  <span
                    className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0"
                    style={{
                      backgroundColor: model.provider === "google" ? "#4285f4" : "#6c5ce7",
                      color: "#fff",
                    }}
                  >
                    {model.provider === "google" ? "G" : "OR"}
                  </span>

                  {/* Model info */}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{model.displayName}</div>
                    <div className="flex items-center gap-2 text-[10px]" style={{ opacity: isSelected ? 0.85 : 0.5 }}>
                      <span>{formatPrice(model.inputPrice)}/{formatPrice(model.outputPrice)}</span>
                      {model.contextLength > 0 && (
                        <span>{Math.round(model.contextLength / 1000)}K</span>
                      )}
                      <span className="flex gap-0.5">
                        {model.supportsVision && "👁"}
                        {model.supportsToolCalling && "🔧"}
                        {model.supportsReasoning && "🧠"}
                      </span>
                    </div>
                  </div>

                  {isSelected && <Check size={16} className="shrink-0" />}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
