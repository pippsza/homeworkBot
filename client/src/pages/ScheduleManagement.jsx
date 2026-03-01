import { useEffect, useState } from "react";
import { Plus, Trash2, Save } from "lucide-react";
import { useApi } from "../hooks/useApi";
import BackButton from "../components/BackButton";
import RoleGuard from "../components/RoleGuard";
import { SkeletonList } from "../components/Skeleton";
import { useToast } from "../components/Toast";

const DAY_NAMES = ["", "Пн", "Вт", "Ср", "Чт", "Пт"];
const DAY_FULL_NAMES = ["", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница"];

function ScheduleManagementContent() {
  const { apiFetch } = useApi();
  const { showToast } = useToast();
  const [schedule, setSchedule] = useState(null);
  const [subjects, setSubjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("timeslots");
  const [activeDay, setActiveDay] = useState(1);

  useEffect(() => {
    Promise.all([apiFetch("/schedule"), apiFetch("/subjects")])
      .then(([s, subj]) => {
        setSchedule(s);
        setSubjects(subj);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="p-4">
        <BackButton to="/admin" />
        <h1 className="text-xl font-bold mb-4">Управление расписанием</h1>
        <SkeletonList count={4} />
      </div>
    );
  }

  const timeSlots = schedule?.timeSlots || [];
  const days = schedule?.days || [];
  const saturdayMappings = schedule?.saturdayMappings || [];

  // --- Time Slots ---
  const saveTimeSlots = async (slots) => {
    setSaving(true);
    try {
      const res = await apiFetch("/schedule/timeslots", {
        method: "PUT",
        body: { timeSlots: slots },
      });
      setSchedule(res);
      showToast("Тайм-слоты сохранены");
    } catch {
      showToast("Ошибка сохранения", "error");
    }
    setSaving(false);
  };

  // --- Day Schedule ---
  const saveDaySchedule = async (day, slots) => {
    setSaving(true);
    try {
      const res = await apiFetch(`/schedule/days/${day}`, {
        method: "PUT",
        body: { slots },
      });
      setSchedule(res);
      showToast(`${DAY_FULL_NAMES[day]} сохранён`);
    } catch {
      showToast("Ошибка сохранения", "error");
    }
    setSaving(false);
  };

  // --- Saturday ---
  const saveSaturday = async (mappings) => {
    setSaving(true);
    try {
      const res = await apiFetch("/schedule/saturday", {
        method: "PUT",
        body: { mappings },
      });
      setSchedule(res);
      showToast("Субботы сохранены");
    } catch {
      showToast("Ошибка сохранения", "error");
    }
    setSaving(false);
  };

  // --- Config ---
  const saveConfig = async (config) => {
    setSaving(true);
    try {
      const res = await apiFetch("/schedule/config", {
        method: "PUT",
        body: config,
      });
      setSchedule(res);
      showToast("Настройки сохранены");
    } catch {
      showToast("Ошибка сохранения", "error");
    }
    setSaving(false);
  };

  const tabs = [
    { id: "timeslots", label: "Пары" },
    { id: "days", label: "Дни" },
    { id: "saturday", label: "Субботы" },
    { id: "config", label: "Настройки" },
  ];

  return (
    <div className="p-4 page-enter">
      <BackButton to="/admin" />
      <h1 className="text-xl font-bold mb-4">Управление расписанием</h1>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors"
            style={{
              backgroundColor:
                activeTab === tab.id
                  ? "var(--tg-theme-button-color)"
                  : "transparent",
              color:
                activeTab === tab.id
                  ? "var(--tg-theme-button-text-color)"
                  : "var(--tg-theme-hint-color)",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "timeslots" && (
        <TimeSlotsEditor
          slots={timeSlots}
          onSave={saveTimeSlots}
          saving={saving}
        />
      )}
      {activeTab === "days" && (
        <DayEditor
          day={activeDay}
          setDay={setActiveDay}
          days={days}
          timeSlots={timeSlots}
          subjects={subjects}
          onSave={saveDaySchedule}
          saving={saving}
        />
      )}
      {activeTab === "saturday" && (
        <SaturdayEditor
          mappings={saturdayMappings}
          onSave={saveSaturday}
          saving={saving}
        />
      )}
      {activeTab === "config" && (
        <ConfigEditor
          schedule={schedule}
          onSave={saveConfig}
          saving={saving}
        />
      )}
    </div>
  );
}

// --- Time Slots Editor ---
function TimeSlotsEditor({ slots, onSave, saving }) {
  const [items, setItems] = useState(
    slots.length
      ? [...slots].sort((a, b) => a.number - b.number)
      : [{ number: 1, startTime: "08:30", endTime: "10:05" }]
  );

  const add = () => {
    const maxNum = items.length ? Math.max(...items.map((s) => s.number)) : 0;
    setItems([...items, { number: maxNum + 1, startTime: "", endTime: "" }]);
  };

  const remove = (i) => setItems(items.filter((_, idx) => idx !== i));

  const update = (i, field, val) => {
    const copy = [...items];
    copy[i] = { ...copy[i], [field]: val };
    setItems(copy);
  };

  return (
    <div>
      <p
        className="text-xs mb-3"
        style={{ color: "var(--tg-theme-hint-color)" }}
      >
        Настройте время начала и конца каждой пары
      </p>

      <div className="space-y-2 mb-4">
        {items.map((slot, i) => (
          <div key={i} className="card flex items-center gap-2">
            <input
              type="number"
              min="1"
              value={slot.number}
              onChange={(e) => update(i, "number", parseInt(e.target.value) || 1)}
              className="w-10 text-center rounded-lg p-1 text-sm"
              style={{
                backgroundColor: "var(--tg-theme-secondary-bg-color)",
                color: "var(--tg-theme-text-color)",
              }}
            />
            <input
              type="time"
              value={slot.startTime}
              onChange={(e) => update(i, "startTime", e.target.value)}
              className="flex-1 rounded-lg p-1 text-sm"
              style={{
                backgroundColor: "var(--tg-theme-secondary-bg-color)",
                color: "var(--tg-theme-text-color)",
              }}
            />
            <span
              className="text-xs"
              style={{ color: "var(--tg-theme-hint-color)" }}
            >
              —
            </span>
            <input
              type="time"
              value={slot.endTime}
              onChange={(e) => update(i, "endTime", e.target.value)}
              className="flex-1 rounded-lg p-1 text-sm"
              style={{
                backgroundColor: "var(--tg-theme-secondary-bg-color)",
                color: "var(--tg-theme-text-color)",
              }}
            />
            <button onClick={() => remove(i)} className="text-red-500 shrink-0">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <button
          onClick={add}
          className="flex-1 py-2.5 rounded-xl text-sm font-medium"
          style={{
            backgroundColor: "var(--tg-theme-secondary-bg-color)",
            color: "var(--tg-theme-text-color)",
          }}
        >
          <Plus size={14} className="inline" /> Добавить пару
        </button>
        <button
          onClick={() => onSave(items)}
          disabled={saving}
          className="flex-1 py-2.5 rounded-xl text-sm font-medium"
          style={{
            backgroundColor: "var(--tg-theme-button-color)",
            color: "var(--tg-theme-button-text-color)",
            opacity: saving ? 0.6 : 1,
          }}
        >
          <Save size={14} className="inline" /> Сохранить
        </button>
      </div>
    </div>
  );
}

// --- Day Schedule Editor ---
function DayEditor({ day, setDay, days, timeSlots, subjects, onSave, saving }) {
  const dayData = days.find((d) => d.dayOfWeek === day);
  const existingSlots = dayData?.slots || [];

  const [slots, setSlots] = useState([]);

  useEffect(() => {
    // Create slot entries for each time slot
    const slotEntries = timeSlots
      .sort((a, b) => a.number - b.number)
      .map((ts) => {
        const existing = existingSlots.find((s) => s.slotNumber === ts.number);
        return {
          slotNumber: ts.number,
          subjectId: existing?.subjectId || "",
          subjectIdEven: existing?.subjectIdEven || "",
          isAlternating: existing?.isAlternating || false,
        };
      });
    setSlots(slotEntries);
  }, [day, JSON.stringify(timeSlots), JSON.stringify(existingSlots)]);

  const updateSlot = (i, field, val) => {
    const copy = [...slots];
    copy[i] = { ...copy[i], [field]: val };
    setSlots(copy);
  };

  const handleSave = () => {
    // Filter out completely empty slots
    const filtered = slots.filter(
      (s) => s.subjectId || s.subjectIdEven
    );
    onSave(day, filtered);
  };

  const ts = (num) => timeSlots.find((t) => t.number === num);

  return (
    <div>
      {/* Day tabs */}
      <div className="flex gap-1 mb-4">
        {[1, 2, 3, 4, 5].map((d) => (
          <button
            key={d}
            onClick={() => setDay(d)}
            className="flex-1 py-1.5 rounded-lg text-sm font-medium transition-colors"
            style={{
              backgroundColor:
                day === d ? "var(--tg-theme-button-color)" : "transparent",
              color:
                day === d
                  ? "var(--tg-theme-button-text-color)"
                  : "var(--tg-theme-hint-color)",
            }}
          >
            {DAY_NAMES[d]}
          </button>
        ))}
      </div>

      {timeSlots.length === 0 ? (
        <p
          className="text-sm text-center py-8"
          style={{ color: "var(--tg-theme-hint-color)" }}
        >
          Сначала настройте тайм-слоты во вкладке "Пары"
        </p>
      ) : (
        <>
          <div className="space-y-3 mb-4">
            {slots.map((slot, i) => {
              const timeInfo = ts(slot.slotNumber);
              return (
                <div key={i} className="card">
                  <div className="flex items-center gap-2 mb-2">
                    <span
                      className="text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center shrink-0"
                      style={{
                        backgroundColor: "var(--tg-theme-button-color)",
                        color: "var(--tg-theme-button-text-color)",
                      }}
                    >
                      {slot.slotNumber}
                    </span>
                    <span
                      className="text-xs"
                      style={{ color: "var(--tg-theme-hint-color)" }}
                    >
                      {timeInfo?.startTime} — {timeInfo?.endTime}
                    </span>
                    <label className="ml-auto flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={slot.isAlternating}
                        onChange={(e) =>
                          updateSlot(i, "isAlternating", e.target.checked)
                        }
                      />
                      Мигалка
                    </label>
                  </div>

                  <select
                    value={slot.subjectId}
                    onChange={(e) => updateSlot(i, "subjectId", e.target.value)}
                    className="w-full rounded-lg p-2 text-sm mb-1"
                    style={{
                      backgroundColor: "var(--tg-theme-secondary-bg-color)",
                      color: "var(--tg-theme-text-color)",
                    }}
                  >
                    <option value="">
                      {slot.isAlternating ? "Нечётная неделя — пусто" : "Пусто"}
                    </option>
                    {subjects.map((s) => (
                      <option key={s._id} value={s._id}>
                        {s.emoji || "📚"} {s.name}
                      </option>
                    ))}
                  </select>

                  {slot.isAlternating && (
                    <select
                      value={slot.subjectIdEven}
                      onChange={(e) =>
                        updateSlot(i, "subjectIdEven", e.target.value)
                      }
                      className="w-full rounded-lg p-2 text-sm"
                      style={{
                        backgroundColor: "var(--tg-theme-secondary-bg-color)",
                        color: "var(--tg-theme-text-color)",
                      }}
                    >
                      <option value="">Чётная неделя — пусто</option>
                      {subjects.map((s) => (
                        <option key={s._id} value={s._id}>
                          {s.emoji || "📚"} {s.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              );
            })}
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full py-2.5 rounded-xl text-sm font-medium"
            style={{
              backgroundColor: "var(--tg-theme-button-color)",
              color: "var(--tg-theme-button-text-color)",
              opacity: saving ? 0.6 : 1,
            }}
          >
            <Save size={14} className="inline" /> Сохранить {DAY_FULL_NAMES[day]}
          </button>
        </>
      )}
    </div>
  );
}

// --- Saturday Mappings Editor ---
function SaturdayEditor({ mappings, onSave, saving }) {
  const [items, setItems] = useState(
    mappings.length
      ? [...mappings].sort((a, b) => a.weekNumber - b.weekNumber)
      : []
  );

  const add = () => {
    const maxWeek = items.length
      ? Math.max(...items.map((m) => m.weekNumber))
      : 0;
    setItems([...items, { weekNumber: maxWeek + 1, followsDay: 1 }]);
  };

  const remove = (i) => setItems(items.filter((_, idx) => idx !== i));

  const update = (i, field, val) => {
    const copy = [...items];
    copy[i] = { ...copy[i], [field]: val };
    setItems(copy);
  };

  return (
    <div>
      <p
        className="text-xs mb-3"
        style={{ color: "var(--tg-theme-hint-color)" }}
      >
        Укажите, по расписанию какого дня проходят субботы (по номеру недели
        семестра)
      </p>

      <div className="space-y-2 mb-4">
        {items.map((item, i) => (
          <div key={i} className="card flex items-center gap-2">
            <span
              className="text-xs shrink-0"
              style={{ color: "var(--tg-theme-hint-color)" }}
            >
              Нед.
            </span>
            <input
              type="number"
              min="1"
              value={item.weekNumber}
              onChange={(e) =>
                update(i, "weekNumber", parseInt(e.target.value) || 1)
              }
              className="w-14 text-center rounded-lg p-1 text-sm"
              style={{
                backgroundColor: "var(--tg-theme-secondary-bg-color)",
                color: "var(--tg-theme-text-color)",
              }}
            />
            <span
              className="text-xs shrink-0"
              style={{ color: "var(--tg-theme-hint-color)" }}
            >
              →
            </span>
            <select
              value={item.followsDay}
              onChange={(e) =>
                update(i, "followsDay", parseInt(e.target.value))
              }
              className="flex-1 rounded-lg p-1 text-sm"
              style={{
                backgroundColor: "var(--tg-theme-secondary-bg-color)",
                color: "var(--tg-theme-text-color)",
              }}
            >
              {[1, 2, 3, 4, 5].map((d) => (
                <option key={d} value={d}>
                  {DAY_FULL_NAMES[d]}
                </option>
              ))}
            </select>
            <button onClick={() => remove(i)} className="text-red-500 shrink-0">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <button
          onClick={add}
          className="flex-1 py-2.5 rounded-xl text-sm font-medium"
          style={{
            backgroundColor: "var(--tg-theme-secondary-bg-color)",
            color: "var(--tg-theme-text-color)",
          }}
        >
          <Plus size={14} className="inline" /> Добавить неделю
        </button>
        <button
          onClick={() => onSave(items)}
          disabled={saving}
          className="flex-1 py-2.5 rounded-xl text-sm font-medium"
          style={{
            backgroundColor: "var(--tg-theme-button-color)",
            color: "var(--tg-theme-button-text-color)",
            opacity: saving ? 0.6 : 1,
          }}
        >
          <Save size={14} className="inline" /> Сохранить
        </button>
      </div>
    </div>
  );
}

// --- Config Editor ---
function ConfigEditor({ schedule, onSave, saving }) {
  const [semesterStart, setSemesterStart] = useState(
    schedule?.semesterStartDate
      ? new Date(schedule.semesterStartDate).toISOString().split("T")[0]
      : ""
  );
  const [chatId, setChatId] = useState(schedule?.notificationChatId || "");
  const [minutes, setMinutes] = useState(schedule?.notifyMinutesBefore ?? 10);
  const [enabled, setEnabled] = useState(
    schedule?.notificationsEnabled || false
  );

  return (
    <div>
      <div className="space-y-4">
        <div className="card">
          <label className="block text-sm font-medium mb-1">
            Дата начала семестра
          </label>
          <p
            className="text-xs mb-2"
            style={{ color: "var(--tg-theme-hint-color)" }}
          >
            Первый понедельник семестра — для определения чётности недели
          </p>
          <input
            type="date"
            value={semesterStart}
            onChange={(e) => setSemesterStart(e.target.value)}
            className="w-full rounded-lg p-2 text-sm"
            style={{
              backgroundColor: "var(--tg-theme-secondary-bg-color)",
              color: "var(--tg-theme-text-color)",
            }}
          />
        </div>

        <div className="card">
          <label className="block text-sm font-medium mb-1">
            Уведомления о парах
          </label>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              Включить уведомления
            </label>

            <div>
              <span
                className="text-xs"
                style={{ color: "var(--tg-theme-hint-color)" }}
              >
                Chat ID группы
              </span>
              <input
                type="text"
                value={chatId}
                onChange={(e) => setChatId(e.target.value)}
                placeholder="-100..."
                className="w-full rounded-lg p-2 text-sm mt-1"
                style={{
                  backgroundColor: "var(--tg-theme-secondary-bg-color)",
                  color: "var(--tg-theme-text-color)",
                }}
              />
            </div>

            <div>
              <span
                className="text-xs"
                style={{ color: "var(--tg-theme-hint-color)" }}
              >
                Уведомлять за (минут)
              </span>
              <input
                type="number"
                min="1"
                max="60"
                value={minutes}
                onChange={(e) => setMinutes(parseInt(e.target.value) || 10)}
                className="w-full rounded-lg p-2 text-sm mt-1"
                style={{
                  backgroundColor: "var(--tg-theme-secondary-bg-color)",
                  color: "var(--tg-theme-text-color)",
                }}
              />
            </div>
          </div>
        </div>
      </div>

      <button
        onClick={() =>
          onSave({
            semesterStartDate: semesterStart || null,
            notificationChatId: chatId || null,
            notifyMinutesBefore: minutes,
            notificationsEnabled: enabled,
          })
        }
        disabled={saving}
        className="w-full mt-4 py-2.5 rounded-xl text-sm font-medium"
        style={{
          backgroundColor: "var(--tg-theme-button-color)",
          color: "var(--tg-theme-button-text-color)",
          opacity: saving ? 0.6 : 1,
        }}
      >
        <Save size={14} className="inline" /> Сохранить настройки
      </button>
    </div>
  );
}

export default function ScheduleManagement() {
  return (
    <RoleGuard
      role="superadmin"
      fallback={
        <div className="p-4 text-center text-[var(--tg-theme-hint-color)]">
          Нет доступа
        </div>
      }
    >
      <ScheduleManagementContent />
    </RoleGuard>
  );
}
