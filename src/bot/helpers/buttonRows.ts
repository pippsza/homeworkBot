/**
 * Розкладка кнопок у рядки.
 *
 * Telegram робить усі кнопки рядка однакової ширини, тому в ряд ставимо
 * стільки, скільки влазить за найдовшим написом: короткі "ЛР 1" йдуть по
 * чотири, довгі назви лишаються по дві. Ширину міряємо в символах.
 */
const ROW_BUDGET = 40;
const MAX_PER_ROW = 4;

export interface Packable {
  btn: unknown;
  label: string;
  /** Кнопка на весь рядок: довгу назву не хочемо різати. */
  fullWidth?: boolean;
}

function width(label: string): number {
  return [...label].length;
}

/** Скільки наступних кнопок стануть в один рядок. */
function autoTake(items: Packable[], from: number): number {
  const limit = Math.min(MAX_PER_ROW, runLength(items, from));
  for (let n = limit; n > 1; n--) {
    const widest = Math.max(...items.slice(from, from + n).map((x) => width(x.label)));
    if (widest * n <= ROW_BUDGET) return n;
  }
  return 1;
}

/** Довжина низки звичайних кнопок до найближчої на весь рядок. */
function runLength(items: Packable[], from: number): number {
  let n = 0;
  while (from + n < items.length && !items[from + n].fullWidth) n++;
  return n;
}

/** `columns` 0 - підбирати автоматично, 1-4 - фіксована кількість. */
export function packRows(items: Packable[], columns = 0): unknown[][] {
  const rows: unknown[][] = [];
  let i = 0;
  while (i < items.length) {
    if (items[i].fullWidth) {
      rows.push([items[i].btn]);
      i++;
      continue;
    }
    const take = columns > 0 ? Math.min(columns, runLength(items, i)) : autoTake(items, i);
    rows.push(items.slice(i, i + take).map((x) => x.btn));
    i += take;
  }
  return rows;
}
