/** Рекомендована дата здачі: коли лишилось 20 % часу від строку виконання. */

const SHARE_LEFT = 0.2;

export function suggestedSubmitDate(
  issuedAt: Date | null | undefined,
  deadline: Date | null | undefined,
): Date | null {
  if (!deadline) return null;
  const due = new Date(deadline).getTime();
  // Без дати видачі рахувати нема від чого - беремо два тижні як типовий строк.
  const from = issuedAt ? new Date(issuedAt).getTime() : due - 14 * 864e5;
  if (!Number.isFinite(due) || !Number.isFinite(from) || due <= from) return null;
  return new Date(due - (due - from) * SHARE_LEFT);
}

export function fmt(d: Date): string {
  return d.toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit" });
}

/** Скільки днів лишилось: відʼємне означає, що дата вже минула. */
export function daysLeft(d: Date, now = new Date()): number {
  return Math.ceil((d.getTime() - now.getTime()) / 864e5);
}

/**
 * Рівномірно розкидає частини роботи від сьогодні до дедлайну.
 * Останню частину ставимо на рекомендовану дату, а не на дедлайн, щоб
 * лишався запас.
 */
export function spreadPlan(
  titles: string[],
  deadline: Date,
  from = new Date(),
): { title: string; due: Date; done: boolean }[] {
  const end = suggestedSubmitDate(from, deadline) ?? deadline;
  const start = from.getTime();
  const span = end.getTime() - start;
  const n = titles.length;
  if (n === 0 || span <= 0) return [];
  return titles.map((title, i) => ({
    title,
    due: new Date(start + (span * (i + 1)) / n),
    done: false,
  }));
}
