import "dotenv/config";
import mongoose from "mongoose";
import Subject from "./models/Subject";
import Schedule from "./models/Schedule";

/**
 * Наповнення бази під осінній семестр 2026-2027, 3 курс, група КН-1124а
 * (спеціальність 125 Кібербезпека, потік КН-1124а + КН-1125с).
 *
 * Запуск: npx tsx src/seed-fall2026.ts
 * Старі предмети скрипт НЕ чіпає: архівацію робить archive-old.ts.
 */

const SEMESTER_START = new Date("2026-09-01T00:00:00+03:00");

const TIME_SLOTS = [
  { number: 1, startTime: "08:30", endTime: "10:00" },
  { number: 2, startTime: "10:25", endTime: "11:55" },
  { number: 3, startTime: "12:35", endTime: "14:05" },
  { number: 4, startTime: "14:30", endTime: "16:00" },
  { number: 5, startTime: "16:25", endTime: "17:55" },
  { number: 6, startTime: "18:10", endTime: "19:40" },
];

const SUBJECTS = [
  {
    key: "ommsb",
    name: "Мат. моделювання систем безпеки",
    emoji: "📐",
    lecturerName: "Мілевський Станіслав Валерійович",
    practitionerName: "Мілевський Станіслав Валерійович",
    telegramChat: "ОММСБ КН-1124, КН-1125с",
    classroomUrl: "https://classroom.google.com/c/NDg5MzM1NjQyODQ3",
    autoPass:
      "Розбалловки ніхто не називав. Відомо лише, що предмет складається з 7 лаб, ессе " +
      "і підсумкової КР. Зозуля (03.09.2026): найгірший предмет семестру - і математика, " +
      "і ессе, і ексель, і програми качати.",
    notes:
      "7 лаб + ессе + підсумкова КР. Курс у Classroom переиспользуется с 2022-2025: " +
      "дедлайны там стоят прошлогодние и помечены «прострочено» - это НЕ долги. " +
      "Вариант задания = номер показателя, у Богдана вариант 1 (Х1), он всегда первый по списку. " +
      "Лаба 1 (статобработка в Excel) сделана 03.09.2026, ессе написано 03.09.2026. " +
      "Код вступу в Classroom: gj5cbvp. Термін лаби 1 - близько 2 тижнів від 03.09.2026.",
    practitionerNote:
      "Пары ведёт в Teams. Лекция чт 10:25 через неделю, лаба чт 14:30 щотижня.",
  },
  {
    key: "micro",
    name: "Мікропроцесорні системи",
    emoji: "🔌",
    lecturerName: "Шматко Олександр Віталійович",
    practitionerName: "Шматко Олександр Віталійович",
    telegramChat: "",
    classroomUrl: "https://classroom.google.com/c/ODc2MTk2MjIxMjEx",
    notes:
      "Код вступу в Classroom: 7k6psd5x. Кафедра КБ (важно для титулок). " +
      "100 балів: практичні 50 + тести на лекціях 16 + проміжний 14 + підсумковий 20. " +
      "Сертифікат Cisco «Introduction to IoT and Digital Transformation» дає 60 балів і " +
      "замінює підсумковий контроль, але обов'язкові практичні на 40 балів усе одно робляться. " +
      "5 лаб на Packet Tracer, у лабі 3 в архіві лежить готовий -Completed.pkt.",
    autoPass:
      "Найкоротший шлях до високого бала: сертифікат Cisco (60) + тести на лекціях + " +
      "відмічена присутність дають близько 90 балів БЕЗ лаб, далі вистачає однієї зробленої " +
      "лаби (Зозуля, 03.09.2026). Лаби здаються без захисту, дві зроблені лаби = 5 балів. " +
      "УВАГА: присутність відмічаєш сам у Classroom (тиснеш на «Лекція 1» справа), але " +
      "викладач бачить ЧАС відмітки - заднім числом за минулі лекції не проставиш.",
    practitionerNote:
      "Дедлайни виставляє в Classroom, їх видно завжди (Degtyarev, 05.09.2026). " +
      "На лабу дає від 2 днів до тижня, у різних по-різному (Danila, 05.09.2026). " +
      "Заняття 03.09.2026 провів як лекцію замість лаби - зараховується як лекція, " +
      "відмічатись треба.",
  },
  {
    key: "stego",
    name: "Стеганографічний захист",
    emoji: "🖼",
    lecturerName: "Корольов",
    practitionerName: "Корольов",
    telegramChat: "БІКС_1124а",
    teamsLink:
      "https://teams.microsoft.com/l/meetup-join/19%3ameeting_Mjc3ODhkNTctZGZhOS00MWFhLWFlZmItYmY5MTdlODgzMzUy%40thread.v2/0?context=%7b%22Tid%22%3a%222611abf3-4765-483b-8358-29d44f20cc60%22%2c%22Oid%22%3a%2236b42bfe-61a5-4b0d-9bf1-8c60b5e8f64c%22%7d",
    notes:
      "Роботи здавати з назвою файлу «Стего_№<номер>_Прізвище», приклад: Стего_№2_Іванов " +
      "(правило озвучено в БІКС_1124а 04.09.2026). " +
      "04.09.2026 викладено: Лекція №1_укр.ppt, Лабораторна робота №1_укр.docx, " +
      "архів «Програмне забезпечення.zip» (474 МБ). " +
      "Курс NetAcad «Endpoint Security» (uk-UA) - реєстрація тільки за запрошенням, " +
      "у Матвія 04.09.2026 не вийшло зареєструватись. " +
      "Богдан пропустив пару в п'ятницю 04.09.2026. " +
      "Термін лаби 1 - 8 навчальних годин, тобто близько 3 тижнів (Ваня, 04.09.2026).",
    autoPass:
      "4 лабораторні по 10 балів + 2 контрольні (перша 20, друга 40) = 100. " +
      "Classroom у предмета НЕМАЄ, усі матеріали летять у ТГ-групу БІКС_1124а. " +
      "Лаби виконуються в парах по 2 людини, крім першої - вона легка і соло " +
      "(Богдан домовився з Кирюшкою 04.09.2026). " +
      "Окремо є курс Cisco по цьому предмету, пройти до 1 ГРУДНЯ 2026, " +
      "скільки балів дає - поки ніхто не знає (Зозуля, 04.09.2026).",
    practitionerNote:
      "Максим вважає, що преподу на нас буде пофіг, Богдан сумнівається - перевірити на практиці. " +
      "Максим також каже, що лаби будуть такі самі, як у Король з криптографії (04.09.2026).",
  },
  {
    key: "biks",
    name: "Безпека в ІКС",
    emoji: "🛡",
    lecturerName: "Корольов",
    practitionerName: "Корольов",
    telegramChat: "БІКС_1124а",
    notes:
      "Другий предмет того самого викладача, спільна ТГ-група з стеганографією. " +
      "Роботи здавати з назвою «БІКС_№<номер>_Прізвище».",
  },
  {
    key: "access",
    name: "Планування та адміністрування служб доступу",
    emoji: "🗄",
    notes: "Каф КБ. Викладач ще не з'ясований.",
  },
  {
    key: "incidents",
    name: "Реагування на кіберінциденти",
    emoji: "🚨",
    notes: "Каф КБ. Викладач ще не з'ясований.",
  },
  {
    key: "blockchain",
    name: "Blockchain",
    emoji: "⛓",
    notes: "Каф КБ. Викладач ще не з'ясований.",
  },
  {
    key: "english",
    name: "Англійська мова",
    emoji: "🇬🇧",
    practitionerName: "Карасьова Олена В'ячеславівна",
    telegramChat: "Англійська мова КН-1124а",
    notes:
      "Група розділена на дві підгрупи, друга у Внукової - тому пари зміщені. " +
      "04.09.2026 був обов'язковий тест у Google Forms, здати треба було того ж дня. " +
      "У Classroom (курс «КН-1124а», Тихонова) висить нездане ессе Ex. 4 p. 45 з Objective IELTS SB.",
    autoPass:
      "Пряма умова викладачки на високий бал: увімкнена камера і активна участь у розмові " +
      "(переказ Вані, 04.09.2026). Тест 04.09.2026 у Google Forms був обов'язковим.",
    practitionerNote:
      "Новий викладач з вересня 2026, до цього була Тихонова. " +
      "Душна і повільна (Максим, 04.09.2026). Вимагає вмикати камери: " +
      "«якщо хтось претендує на високий бал, потрібно камеру turn on і комунікувати частіше» " +
      "(переказ Вані, 04.09.2026).",
  },
];

// slot: [номер пари, ключ предмета, тип]; для мигалок - другий предмет через "|"
const DAYS: Record<number, Array<[number, string, string, string?, string?]>> = {
  1: [
    [1, "access", "ЛБ"],
    [2, "incidents", "ЛБ"],
    [3, "blockchain", "ЛБ", "biks", "ЛБ"],
  ],
  3: [
    [1, "blockchain", "ЛК", "access", "ЛК"],
    [2, "biks", "ЛК"],
    [3, "incidents", "ЛК", "", ""],
  ],
  4: [
    [2, "ommsb", "ЛК", "micro", "ЛК"],
    [3, "micro", "ЛБ"],
    [4, "ommsb", "ЛБ"],
  ],
  5: [
    [1, "stego", "ЛБ"],
    [2, "stego", "ЛК"],
    [3, "english", "ПЗ"],
  ],
};

async function seed(): Promise<void> {
  const uri = process.env.MONGODB_URI || "mongodb://localhost:27017/homeworkbot";
  await mongoose.connect(uri);
  console.log("[seed] connected:", uri);

  const ids: Record<string, mongoose.Types.ObjectId> = {};
  for (const [i, s] of SUBJECTS.entries()) {
    const { key, ...fields } = s;
    const doc = await Subject.findOneAndUpdate(
      { name: fields.name },
      { ...fields, order: i },
      { upsert: true, returnDocument: "after" }
    );
    ids[key] = doc!._id as mongoose.Types.ObjectId;
    console.log(`[seed] subject: ${fields.emoji} ${fields.name}`);
  }

  const days = Object.entries(DAYS).map(([dow, slots]) => ({
    dayOfWeek: Number(dow),
    slots: slots.map(([n, key, kind, evenKey, evenKind]) => ({
      slotNumber: n,
      subjectId: ids[key] ?? null,
      subjectIdEven: evenKey ? ids[evenKey] ?? null : evenKey === "" ? null : ids[key] ?? null,
      isAlternating: evenKey !== undefined,
      kind: kind,
      kindEven: evenKind ?? kind,
    })),
  }));

  await Schedule.findOneAndUpdate(
    { key: "main" },
    { timeSlots: TIME_SLOTS, days, semesterStartDate: SEMESTER_START },
    { upsert: true }
  );
  console.log("[seed] schedule written, semester starts", SEMESTER_START.toISOString());

  await mongoose.disconnect();
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
