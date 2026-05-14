import type { ISODateString } from "@/types";

const WD_JA = ["日", "月", "火", "水", "木", "金", "土"] as const;

export function parseISODate(iso: ISODateString): { y: number; m: number; d: number } {
  const [ys, ms, ds] = iso.split("-").map(Number);
  return { y: ys, m: ms, d: ds };
}

/** 0 = 日曜 … 6 = 土曜（ローカル日付として解釈） */
export function weekdaySun0(iso: ISODateString): number {
  const { y, m, d } = parseISODate(iso);
  return new Date(y, m - 1, d).getDay();
}

export function weekdayLabelJa(iso: ISODateString): string {
  return WD_JA[weekdaySun0(iso)];
}

export function compareIso(a: ISODateString, b: ISODateString): number {
  return a.localeCompare(b);
}

export function addDays(iso: ISODateString, delta: number): ISODateString {
  const { y, m, d } = parseISODate(iso);
  const dt = new Date(y, m - 1, d + delta);
  const mm = dt.getMonth() + 1;
  const dd = dt.getDate();
  const yy = dt.getFullYear();
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${yy}-${pad(mm)}-${pad(dd)}`;
}

export function* eachDateInclusive(
  start: ISODateString,
  end: ISODateString,
): Generator<ISODateString> {
  let cur = start;
  while (compareIso(cur, end) <= 0) {
    yield cur;
    cur = addDays(cur, 1);
  }
}

export function isWeekdayMonFri(iso: ISODateString): boolean {
  const w = weekdaySun0(iso);
  return w >= 1 && w <= 5;
}

export function isSaturday(iso: ISODateString): boolean {
  return weekdaySun0(iso) === 6;
}

export function isSunday(iso: ISODateString): boolean {
  return weekdaySun0(iso) === 0;
}
