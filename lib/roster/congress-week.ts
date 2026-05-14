import type { ISODateString } from "@/types";
import { parseISODate } from "./dates";

/**
 * その日が属する「月内の第何週」か（月曜始まりの週ブロック）。
 * - その月の最初の月曜より前の平日は第1週にまとめる（月初と同一週当番が担当）。
 * - 各ブロックは「月曜〜次の月曜の前日」まで（暦上の週と整合）。
 */
export function mondayBasedWeekIndexInMonth(iso: ISODateString): 1 | 2 | 3 | 4 | 5 | 6 {
  const { y, m, d } = parseISODate(iso);
  const lastDay = new Date(y, m, 0).getDate();
  const mondayDomesticDays: number[] = [];
  for (let day = 1; day <= lastDay; day++) {
    if (new Date(y, m - 1, day).getDay() === 1) {
      mondayDomesticDays.push(day);
    }
  }
  if (mondayDomesticDays.length === 0) {
    return 1;
  }
  const firstMonday = mondayDomesticDays[0];
  if (d < firstMonday) {
    return 1;
  }
  for (let i = 0; i < mondayDomesticDays.length; i++) {
    const start = mondayDomesticDays[i];
    const end =
      i + 1 < mondayDomesticDays.length ? mondayDomesticDays[i + 1]! - 1 : lastDay;
    if (d >= start && d <= end) {
      const w = i + 1;
      return Math.min(6, w) as 1 | 2 | 3 | 4 | 5 | 6;
    }
  }
  return 6;
}

export function yearMonthFromIso(iso: ISODateString): string {
  return iso.slice(0, 7);
}
