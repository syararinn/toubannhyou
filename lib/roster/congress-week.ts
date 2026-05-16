import type { ISODateString } from "@/types";
import { parseISODate } from "./dates";

/**
 * その日が属する「月内の第何週」か（月曜始まりの週ブロック）。
 * - **第1週**: その月の最初の月曜より前の日のみ（月初が月曜の月は第1週に該当する日はない）。
 * - **第2週以降**: 最初の月曜から次の月曜の前日までを第2週、以降も各月曜ブロックで番号が増える。
 *
 * 国会週当番の UI「第N週」と一致させるため、月初の「月曜前」と「最初の月曜からの1週目」を同一番号にしない。
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
  const firstMonday = mondayDomesticDays[0]!;
  if (d < firstMonday) {
    return 1;
  }
  const hasLeadingBeforeMonday = firstMonday > 1;
  for (let i = 0; i < mondayDomesticDays.length; i++) {
    const start = mondayDomesticDays[i]!;
    const end =
      i + 1 < mondayDomesticDays.length ? mondayDomesticDays[i + 1]! - 1 : lastDay;
    if (d >= start && d <= end) {
      const w = (hasLeadingBeforeMonday ? 2 : 1) + i;
      return Math.min(6, w) as 1 | 2 | 3 | 4 | 5 | 6;
    }
  }
  return 6;
}

export function yearMonthFromIso(iso: ISODateString): string {
  return iso.slice(0, 7);
}
