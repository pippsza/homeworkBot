import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Paperclip, ChevronRight, Plus } from "lucide-react";
import { useApi } from "../hooks/useApi";
import { SkeletonList } from "../components/Skeleton";
import EmptyState from "../components/EmptyState";

export default function InfosList() {
  const { apiFetch } = useApi();
  const navigate = useNavigate();
  const [infos, setInfos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isStudent, setIsStudent] = useState(false);

  useEffect(() => {
    apiFetch("/infos")
      .then(setInfos)
      .catch(console.error)
      .finally(() => setLoading(false));
    apiFetch("/users/me")
      .then((u) => setIsStudent(u.isStudent))
      .catch(() => {});
  }, []);

  if (loading) {
    return (
      <div className="p-4">
        <h1 className="text-xl font-bold mb-4">Информация</h1>
        <SkeletonList count={4} />
      </div>
    );
  }

  return (
    <>
      <div className="p-4 page-enter">
        <h1 className="text-xl font-bold mb-4">Информация</h1>
        {infos.length === 0 ? (
          <EmptyState
            emoji="ℹ️"
            title="Нет информации"
            description="Информация пока не добавлена"
          />
        ) : (
          <div className="space-y-2">
            {infos.map((info) => (
              <div
                key={info._id}
                className="card flex items-center gap-3"
                onClick={() => navigate(`/infos/${info._id}`)}
              >
                <span className="text-2xl">{info.emoji || "ℹ️"}</span>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{info.title}</div>
                  {info.description && (
                    <div className="text-xs text-[var(--tg-theme-hint-color)] truncate">
                      {info.description.slice(0, 80)}
                    </div>
                  )}
                </div>
                {info.chunkCount > 0 && (
                  <span className="text-xs text-[var(--tg-theme-hint-color)]">
                    🧩 {info.chunkCount}
                  </span>
                )}
                {info.attachments?.length > 0 && (
                  <span className="text-xs text-[var(--tg-theme-hint-color)]">
                    <Paperclip size={12} className="inline" /> {info.attachments.length}
                  </span>
                )}
                <ChevronRight size={16} className="text-[var(--tg-theme-hint-color)] shrink-0" />
              </div>
            ))}
          </div>
        )}
      </div>
      {isStudent && (
        <button
          onClick={() => navigate("/admin/infos")}
          className="fixed left-4 z-40 w-12 h-12 rounded-full flex items-center justify-center shadow-lg"
          style={{
            bottom: "70px",
            backgroundColor: "var(--tg-theme-button-color)",
            color: "var(--tg-theme-button-text-color)",
          }}
        >
          <Plus size={24} />
        </button>
      )}
    </>
  );
}
