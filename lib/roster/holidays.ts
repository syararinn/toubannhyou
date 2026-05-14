import type { ISODateString } from "@/types";

/**
 * 2026 年の国民の祝日（振替休日を含む簡易セット）。
 * 本番では API または管理者入力とマージすること。
 */
export const JP_HOLIDAYS_2026: Record<ISODateString, string> = {
  "2026-01-01": "元日",
  "2026-01-12": "成人の日",
  "2026-02-11": "建国記念の日",
  "2026-02-23": "天皇誕生日",
  "2026-03-20": "春分の日",
  "2026-04-29": "昭和の日",
  "2026-05-03": "憲法記念日",
  "2026-05-04": "みどりの日",
  "2026-05-05": "こどもの日",
  "2026-05-06": "振替休日",
  "2026-07-20": "海の日",
  "2026-08-11": "山の日",
  "2026-09-21": "敬老の日",
  "2026-09-22": "国民の休日",
  "2026-09-23": "秋分の日",
  "2026-10-12": "スポーツの日",
  "2026-11-03": "文化の日",
  "2026-11-23": "勤労感謝の日",
};

export function holidayNameOn(
  iso: ISODateString,
  extra: Record<ISODateString, string>,
): string {
  return extra[iso] ?? JP_HOLIDAYS_2026[iso] ?? "";
}

export function isSundayOrNationalHoliday(
  iso: ISODateString,
  extra: Record<ISODateString, string>,
): boolean {
  const [y, m, d] = iso.split("-").map(Number);
  const sun0 = new Date(y, m - 1, d).getDay();
  if (sun0 === 0) return true;
  return Boolean(holidayNameOn(iso, extra));
}
