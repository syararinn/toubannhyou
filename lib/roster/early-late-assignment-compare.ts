import type { DutyMember, ISODateString } from "@/types";
import { compareForDutyCountAssignment } from "./duty-count-assignment";
import {
  getFlags,
  hadCongressDutyYesterday,
  type PreferenceMap,
  type YesterdaySlotMap,
} from "./eligibility";
import { addDays, isSunday } from "./dates";
import { holidayNameOn } from "./holidays";

function hadSunOrHolidayCalendarYesterday(
  date: ISODateString,
  hol: Record<ISODateString, string>,
): boolean {
  const yesterday = addDays(date, -1);
  return isSunday(yesterday) || Boolean(holidayNameOn(yesterday, hol));
}

function matchesLateEqualizationBoost(
  m: DutyMember,
  date: ISODateString,
  prefsMap: Record<DutyMember, PreferenceMap>,
  yesterdayKind: YesterdaySlotMap,
  hol: Record<ISODateString, string>,
): boolean {
  const flags = getFlags(prefsMap[m], date);
  return (
    flags.morningHalfOff ||
    hadCongressDutyYesterday(yesterdayKind, m) ||
    hadSunOrHolidayCalendarYesterday(date, hol)
  );
}

function matchesEarlyEqualizationBoost(
  m: DutyMember,
  date: ISODateString,
  prefsMap: Record<DutyMember, PreferenceMap>,
  yesterdayKind: YesterdaySlotMap,
): boolean {
  const flags = getFlags(prefsMap[m], date);
  return flags.afternoonHalfOff || hadCongressDutyYesterday(yesterdayKind, m);
}

/**
 * 半休・国会翌日・日祝翌日・夜×早番の同数化向け優先（※序列端数より下位）。
 * 負なら a を先に選ぶ。
 */
export function compareEqualizationSoftPreferences(
  a: DutyMember,
  b: DutyMember,
  kind: "早番" | "遅番",
  date: ISODateString,
  prefsMap: Record<DutyMember, PreferenceMap>,
  yesterdayKind: YesterdaySlotMap,
  hol: Record<ISODateString, string>,
): number {
  if (kind === "遅番") {
    const ma = matchesLateEqualizationBoost(a, date, prefsMap, yesterdayKind, hol);
    const mb = matchesLateEqualizationBoost(b, date, prefsMap, yesterdayKind, hol);
    if (ma !== mb) return ma ? -1 : 1;
    return 0;
  }

  const ma = matchesEarlyEqualizationBoost(a, date, prefsMap, yesterdayKind);
  const mb = matchesEarlyEqualizationBoost(b, date, prefsMap, yesterdayKind);
  if (ma !== mb) return ma ? -1 : 1;

  const nightA = getFlags(prefsMap[a], date).nightUnavailable;
  const nightB = getFlags(prefsMap[b], date).nightUnavailable;
  if (nightA !== nightB) return nightA ? -1 : 1;

  return 0;
}

/**
 * 早番・遅番の割当ソート（週次同数 → 期間同数 → ※序列端数 → 半休等のソフト優先）。
 */
export function compareForEarlyLateSlotAssignment(
  a: DutyMember,
  b: DutyMember,
  kind: "早番" | "遅番",
  weeklyEarly: Record<DutyMember, number>,
  weeklyLate: Record<DutyMember, number>,
  periodCounts: Record<DutyMember, number>,
  date: ISODateString,
  prefsMap: Record<DutyMember, PreferenceMap>,
  yesterdayKind: YesterdaySlotMap,
  hol: Record<ISODateString, string>,
): number {
  const weekly = kind === "早番" ? weeklyEarly : weeklyLate;
  const wa = weekly[a] ?? 0;
  const wb = weekly[b] ?? 0;
  if (wa !== wb) return wa - wb;

  const dutyCmp = compareForDutyCountAssignment(a, b, periodCounts);
  if (dutyCmp !== 0) return dutyCmp;

  return compareEqualizationSoftPreferences(
    a,
    b,
    kind,
    date,
    prefsMap,
    yesterdayKind,
    hol,
  );
}
