import Teacher, { ITeacher } from "../models/Teacher";
import Subject from "../models/Subject";

export async function getAll(): Promise<ITeacher[]> {
  return Teacher.find().sort({ name: 1 });
}

export async function getById(id: string): Promise<ITeacher | null> {
  return Teacher.findById(id);
}

export async function create(data: Partial<ITeacher>): Promise<ITeacher> {
  return Teacher.create(data);
}

export async function update(id: string, data: Partial<ITeacher>): Promise<ITeacher | null> {
  return Teacher.findByIdAndUpdate(id, data, { new: true });
}

/** Видаляємо викладача і знімаємо посилання з предметів, щоб не лишались пусті. */
export async function remove(id: string): Promise<void> {
  await Subject.updateMany({ lecturer: id }, { $set: { lecturer: null } });
  await Subject.updateMany({ practitioner: id }, { $set: { practitioner: null } });
  await Teacher.findByIdAndDelete(id);
}

/** Де він задіяний: назва предмета і в якій ролі. */
export async function subjectsOf(id: string): Promise<{ name: string; role: string }[]> {
  const subjects = await Subject.find({ $or: [{ lecturer: id }, { practitioner: id }] }).select(
    "name emoji lecturer practitioner"
  );
  return subjects.map((s: any) => {
    const roles: string[] = [];
    if (String(s.lecturer) === id) roles.push("лекції");
    if (String(s.practitioner) === id) roles.push("практика");
    return { name: `${s.emoji || "📚"} ${s.name}`, role: roles.join(" + ") };
  });
}

/** Коротке ім'я на кнопку: «Мілевський Станіслав Валерійович» → «Мілевський С. В.» */
export function shortName(full: string): string {
  const parts = full.trim().split(/\s+/);
  if (parts.length < 2) return full.slice(0, 20);
  const initials = parts.slice(1, 3).map((p) => p[0].toUpperCase() + ".").join(" ");
  return `${parts[0]} ${initials}`;
}

/**
 * Переносимо викладачів із рядкових полів предметів у окремі записи.
 * Однакові ПІБ зливаються в одного - саме заради цього все й затівалось.
 */
export async function migrateFromSubjects(): Promise<number> {
  const subjects = await Subject.find();
  const byName = new Map<string, ITeacher>();
  for (const t of await getAll()) byName.set(t.name.trim(), t);

  let linked = 0;
  for (const s of subjects as any[]) {
    for (const [field, nameField, contactField, noteField] of [
      ["lecturer", "lecturerName", "lecturerContact", "lecturerNote"],
      ["practitioner", "practitionerName", "practitionerContact", "practitionerNote"],
    ] as const) {
      const name = (s[nameField] || "").trim();
      if (!name || s[field]) continue;
      let teacher = byName.get(name);
      if (!teacher) {
        teacher = await create({
          name,
          short: shortName(name),
          contact: s[contactField] || "",
          note: s[noteField] || "",
        });
        byName.set(name, teacher);
      }
      s[field] = teacher._id;
      linked++;
    }
    if (s.isModified()) await s.save();
  }
  return linked;
}
