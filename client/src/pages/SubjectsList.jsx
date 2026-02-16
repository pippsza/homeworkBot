import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import { ChevronRight } from "lucide-react";
import { SkeletonList } from "../components/Skeleton";
import EmptyState from "../components/EmptyState";

export default function SubjectsList() {
  const { apiFetch } = useApi();
  const navigate = useNavigate();
  const [subjects, setSubjects] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch("/subjects")
      .then(setSubjects)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="p-4">
        <h1 className="text-xl font-bold mb-4">Предметы</h1>
        <SkeletonList count={5} />
      </div>
    );
  }

  return (
    <div className="p-4 page-enter">
      <h1 className="text-xl font-bold mb-4">Предметы</h1>
      {subjects.length === 0 ? (
        <EmptyState
          emoji="📚"
          title="Нет предметов"
          description="Предметы пока не добавлены"
        />
      ) : (
        <div className="space-y-2">
          {subjects.map((s) => (
            <div
              key={s._id}
              className="card flex items-center gap-3"
              onClick={() => navigate(`/subjects/${s._id}`)}
            >
              <span className="text-2xl">{s.emoji || "📚"}</span>
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{s.name}</div>
                {s.lecturerName && (
                  <div className="text-xs text-[var(--tg-theme-hint-color)] truncate">
                    {s.lecturerName}
                  </div>
                )}
              </div>
              <ChevronRight size={16} style={{ color: "var(--tg-theme-hint-color)" }} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
