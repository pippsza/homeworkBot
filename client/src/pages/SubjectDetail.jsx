import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Paperclip, MessageSquare } from "lucide-react";
import { useApi } from "../hooks/useApi";
import BackButton from "../components/BackButton";
import { SkeletonDetail } from "../components/Skeleton";
import EmptyState from "../components/EmptyState";

export default function SubjectDetail() {
  const { id } = useParams();
  const { apiFetch } = useApi();
  const navigate = useNavigate();
  const [subject, setSubject] = useState(null);
  const [canViewAnswers, setCanViewAnswers] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiFetch(`/subjects/${id}`),
      apiFetch("/users/me"),
    ])
      .then(([subj, user]) => {
        setSubject(subj);
        setCanViewAnswers(user.isAnswerViewer);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="p-4">
        <BackButton to="/" />
        <SkeletonDetail />
      </div>
    );
  }

  if (!subject) {
    return (
      <div className="p-4">
        <BackButton to="/" />
        <EmptyState emoji="🔍" title="Предмет не найден" />
      </div>
    );
  }

  return (
    <div className="p-4 page-enter">
      <BackButton to="/" />
      <div className="flex items-center gap-3 mb-4">
        <span className="text-3xl">{subject.emoji || "📚"}</span>
        <h1 className="text-xl font-bold">{subject.name}</h1>
      </div>

      {(subject.lecturerName || subject.practitionerName) && (
        <div className="card mb-4" style={{ cursor: "default" }}>
          {subject.lecturerName && (
            <div className="mb-1">
              <span className="text-sm font-medium">Лектор: </span>
              <span>{subject.lecturerName}</span>
              {subject.lecturerContact && (
                <div className="text-xs text-[var(--tg-theme-hint-color)] ml-4 mt-0.5">
                  {subject.lecturerContact}
                </div>
              )}
            </div>
          )}
          {subject.practitionerName && (
            <div>
              <span className="text-sm font-medium">Практик: </span>
              <span>{subject.practitionerName}</span>
              {subject.practitionerContact && (
                <div className="text-xs text-[var(--tg-theme-hint-color)] ml-4 mt-0.5">
                  {subject.practitionerContact}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <h2 className="text-sm font-semibold text-[var(--tg-theme-hint-color)] mb-2">
        Задания
      </h2>
      {subject.tasks?.length === 0 ? (
        <EmptyState emoji="📝" title="Нет заданий" description="Задания пока не добавлены" />
      ) : (
        <div className="space-y-2">
          {subject.tasks.map((t) => (
            <div
              key={t._id}
              className="card flex items-center gap-3"
              onClick={() => navigate(`/tasks/${t._id}`)}
            >
              <span className="text-xl">{t.emoji || "📄"}</span>
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{t.title}</div>
                {t.description && (
                  <div className="text-xs text-[var(--tg-theme-hint-color)] truncate">
                    {t.description.slice(0, 80)}
                  </div>
                )}
              </div>
              <div className="flex gap-1 text-xs text-[var(--tg-theme-hint-color)]">
                {t.attachments?.length > 0 && <span><Paperclip size={12} />{t.attachments.length}</span>}
                {canViewAnswers && t.answers?.length > 0 && <span><MessageSquare size={12} />{t.answers.length}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
