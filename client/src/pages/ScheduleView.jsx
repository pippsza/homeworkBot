import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { SkeletonList } from "../components/Skeleton";
import EmptyState from "../components/EmptyState";

function formatDate(date) {
  return date.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    weekday: "long",
  });
}

function toDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export default function ScheduleView() {
  const { apiFetch } = useApi();
  const navigate = useNavigate();
  const [offset, setOffset] = useState(0);
  const [schedule, setSchedule] = useState(null);
  const [loading, setLoading] = useState(true);

  const currentDate = new Date();
  currentDate.setDate(currentDate.getDate() + offset);

  useEffect(() => {
    setLoading(true);
    const dateStr = toDateString(currentDate);
    apiFetch(`/schedule/date/${dateStr}`)
      .then(setSchedule)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [offset]);

  if (loading && !schedule) {
    return (
      <div className="p-4">
        <h1 className="text-xl font-bold mb-4">Расписание</h1>
        <SkeletonList count={4} />
      </div>
    );
  }

  const weekType = schedule?.isOdd ? "нечётная" : "чётная";

  return (
    <div className="p-4 page-enter">
      <h1 className="text-xl font-bold mb-2">📅 Расписание</h1>

      {/* Navigation */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => setOffset((o) => o - 1)}
          className="p-2 rounded-lg"
          style={{ color: "var(--tg-theme-button-color)" }}
        >
          <ChevronLeft size={24} />
        </button>

        <div className="text-center">
          <div className="font-medium capitalize">{formatDate(currentDate)}</div>
          {schedule && (
            <div
              className="text-xs"
              style={{ color: "var(--tg-theme-hint-color)" }}
            >
              Неделя {schedule.weekNumber} ({weekType})
              {schedule.isSaturday && schedule.followsDayName && (
                <> &middot; по расп. {schedule.followsDayName.toLowerCase()}</>
              )}
            </div>
          )}
        </div>

        <button
          onClick={() => setOffset((o) => o + 1)}
          className="p-2 rounded-lg"
          style={{ color: "var(--tg-theme-button-color)" }}
        >
          <ChevronRight size={24} />
        </button>
      </div>

      {/* Today button */}
      {offset !== 0 && (
        <div className="flex justify-center mb-4">
          <button
            onClick={() => setOffset(0)}
            className="text-sm px-4 py-1.5 rounded-full"
            style={{
              backgroundColor: "var(--tg-theme-button-color)",
              color: "var(--tg-theme-button-text-color)",
            }}
          >
            Сегодня
          </button>
        </div>
      )}

      {/* Classes */}
      {!schedule || schedule.classes.length === 0 ? (
        <EmptyState
          emoji="🎉"
          title="Нет занятий"
          description={
            schedule?.noMapping
              ? "Для этой субботы не задано расписание"
              : "На этот день нет пар"
          }
        />
      ) : (
        <div className="space-y-2">
          {schedule.classes.map((cls, i) => (
            <div
              key={i}
              className="card flex items-center gap-3"
              onClick={() =>
                cls.subjectId && navigate(`/subjects/${cls.subjectId}`)
              }
            >
              <div
                className="text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center shrink-0"
                style={{
                  backgroundColor: "var(--tg-theme-button-color)",
                  color: "var(--tg-theme-button-text-color)",
                }}
              >
                {cls.slotNumber}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">
                  {cls.subjectEmoji || "📚"} {cls.subjectName || "—"}
                </div>
                <div
                  className="text-xs"
                  style={{ color: "var(--tg-theme-hint-color)" }}
                >
                  {cls.startTime} — {cls.endTime}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
