import type {
  DutyMember,
  ISODateString,
  MemberDayPreferenceFlags,
  PreferenceLimitApplication,
  YearMonthString,
} from "@/types";
import {
  DEFAULT_HALF_DAY_MARKS_PER_MONTH,
  DEFAULT_PREFERENCE_MONTHLY_CAPS,
  MAX_PREFERENCE_LIMIT_APPLICATIONS_PER_MONTH,
} from "@/types";

export function yearMonthFromParts(year: number, month0: number): YearMonthString {
  const m = month0 + 1;
  return `${year}-${m < 10 ? `0${m}` : m}`;
}

export function preferenceApplicationStorageKey(
  dutyMember: DutyMember,
  yearMonth: YearMonthString,
  id: string,
): string {
  return `${dutyMember}:${yearMonth}:${id}`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function listDatesInMonth(year: number, month0: number): ISODateString[] {
  const last = new Date(year, month0 + 1, 0).getDate();
  const out: ISODateString[] = [];
  for (let d = 1; d <= last; d++) {
    out.push(`${year}-${pad2(month0 + 1)}-${pad2(d)}`);
  }
  return out;
}

export function emptyPreferenceFlags(): MemberDayPreferenceFlags {
  return {
    fullDayOff: false,
    fullyUnavailable: false,
    morningHalfOff: false,
    afternoonHalfOff: false,
    nightUnavailable: false,
  };
}

/** 休・✖ のみ（申請・部長承認の対象） */
export function countRestCrossMarks(
  flagsByDate: Record<ISODateString, MemberDayPreferenceFlags>,
  year: number,
  month0: number,
): number {
  let n = 0;
  for (const date of listDatesInMonth(year, month0)) {
    const f = flagsByDate[date] ?? emptyPreferenceFlags();
    if (f.fullDayOff) n += 1;
    if (f.fullyUnavailable) n += 1;
  }
  return n;
}

/** 午前・午後半休（申請対象外。既定3まで） */
export function countHalfDayMarks(
  flagsByDate: Record<ISODateString, MemberDayPreferenceFlags>,
  year: number,
  month0: number,
): number {
  let n = 0;
  for (const date of listDatesInMonth(year, month0)) {
    const f = flagsByDate[date] ?? emptyPreferenceFlags();
    if (f.morningHalfOff) n += 1;
    if (f.afternoonHalfOff) n += 1;
  }
  return n;
}

export function countNightMarks(
  flagsByDate: Record<ISODateString, MemberDayPreferenceFlags>,
  year: number,
  month0: number,
): number {
  let n = 0;
  for (const date of listDatesInMonth(year, month0)) {
    const f = flagsByDate[date] ?? emptyPreferenceFlags();
    if (f.nightUnavailable) n += 1;
  }
  return n;
}

export interface EffectivePreferenceCaps {
  restCross: number;
  night: number;
  halfDay: number;
}

export function getEffectivePreferenceCaps(
  applications: readonly PreferenceLimitApplication[],
): EffectivePreferenceCaps {
  const base = DEFAULT_PREFERENCE_MONTHLY_CAPS;
  const approved = applications.filter((a) => a.status === "approved");
  const pending = applications.find((a) => a.status === "pending");

  let restCross =
    base.maxBasePreferenceMarksPerMonth +
    approved.reduce((sum, a) => sum + a.approvedExtraRestCross, 0);
  let night =
    base.maxNightUnavailableMarksPerMonth +
    approved.reduce((sum, a) => sum + a.approvedExtraNight, 0);

  if (pending) {
    restCross = Math.max(restCross, pending.restCrossMarksAtSubmit);
    night = Math.max(night, pending.nightMarksAtSubmit);
  }

  return {
    restCross,
    night,
    halfDay: DEFAULT_HALF_DAY_MARKS_PER_MONTH,
  };
}

export function isRestCrossOverCap(
  marks: number,
  caps: EffectivePreferenceCaps,
): boolean {
  return marks > caps.restCross;
}

export function isNightOverCap(marks: number, caps: EffectivePreferenceCaps): boolean {
  return marks > caps.night;
}

export function needsPreferenceLimitApplication(
  restCrossMarks: number,
  nightMarks: number,
  caps: EffectivePreferenceCaps,
): { restCross: boolean; night: boolean } {
  return {
    restCross: isRestCrossOverCap(restCrossMarks, caps),
    night: isNightOverCap(nightMarks, caps),
  };
}

/** 申請に休・✖ または夜✖ のいずれかの理由が書かれているか（両方空は不可） */
export function preferenceApplicationHasAnyReason(
  restCrossReason: string,
  nightReason: string,
): boolean {
  return restCrossReason.trim().length > 0 || nightReason.trim().length > 0;
}

export interface PreferenceApplicationSubmitEligibility {
  allowed: boolean;
  blockReason?: string;
  usedCount: number;
  maxCount: number;
}

export function getPreferenceApplicationSubmitEligibility(
  applications: readonly PreferenceLimitApplication[],
): PreferenceApplicationSubmitEligibility {
  const maxCount = MAX_PREFERENCE_LIMIT_APPLICATIONS_PER_MONTH;
  const usedCount = applications.length;
  if (applications.some((a) => a.status === "pending")) {
    return {
      allowed: false,
      usedCount,
      maxCount,
      blockReason: "審査中の申請があります。結果を待ってから次の申請をしてください。",
    };
  }
  if (usedCount >= maxCount) {
    return {
      allowed: false,
      usedCount,
      maxCount,
      blockReason: `今月の申請は ${maxCount} 回までです。追加の相談は部長へ直接お問い合わせください。`,
    };
  }
  return { allowed: true, usedCount, maxCount };
}

export function countRestCrossMarksForFlags(
  flagsByDate: Record<ISODateString, MemberDayPreferenceFlags>,
  year: number,
  month0: number,
  date: ISODateString,
  flags: MemberDayPreferenceFlags,
): number {
  let n = 0;
  for (const d of listDatesInMonth(year, month0)) {
    const f = d === date ? flags : (flagsByDate[d] ?? emptyPreferenceFlags());
    if (f.fullDayOff) n += 1;
    if (f.fullyUnavailable) n += 1;
  }
  return n;
}

export function countHalfDayMarksForFlags(
  flagsByDate: Record<ISODateString, MemberDayPreferenceFlags>,
  year: number,
  month0: number,
  date: ISODateString,
  flags: MemberDayPreferenceFlags,
): number {
  let n = 0;
  for (const d of listDatesInMonth(year, month0)) {
    const f = d === date ? flags : (flagsByDate[d] ?? emptyPreferenceFlags());
    if (f.morningHalfOff) n += 1;
    if (f.afternoonHalfOff) n += 1;
  }
  return n;
}

export function countNightMarksForFlags(
  flagsByDate: Record<ISODateString, MemberDayPreferenceFlags>,
  year: number,
  month0: number,
  date: ISODateString,
  flags: MemberDayPreferenceFlags,
): number {
  let n = 0;
  for (const d of listDatesInMonth(year, month0)) {
    const f = d === date ? flags : (flagsByDate[d] ?? emptyPreferenceFlags());
    if (f.nightUnavailable) n += 1;
  }
  return n;
}

export type PreferenceToggleKey = keyof MemberDayPreferenceFlags;

/**
 * 同日に選べない組み合わせ（午前半休×午後半休、午前半休×夜✖）。
 * チェック ON 時に既存フラグと競合する場合はメッセージを返す。
 */
export function preferenceToggleBlockedBySameDayConflict(
  flags: MemberDayPreferenceFlags,
  key: PreferenceToggleKey,
  checking: boolean,
): string | null {
  if (!checking) return null;
  if (key === "morningHalfOff") {
    if (flags.afternoonHalfOff) return "午前半休と午後半休は同日に選べません。";
    if (flags.nightUnavailable) return "午前半休と夜✖は同日に選べません。";
  }
  if (key === "afternoonHalfOff" && flags.morningHalfOff) {
    return "午前半休と午後半休は同日に選べません。";
  }
  if (key === "nightUnavailable" && flags.morningHalfOff) {
    return "午前半休と夜✖は同日に選べません。";
  }
  return null;
}

/** 競合する別フラグが既に ON のとき、追加チェック用の入力を無効化する */
export function isPreferenceToggleDisabled(
  flags: MemberDayPreferenceFlags,
  key: PreferenceToggleKey,
): boolean {
  if (key === "morningHalfOff" && !flags.morningHalfOff) {
    return flags.afternoonHalfOff || flags.nightUnavailable;
  }
  if (key === "afternoonHalfOff" && !flags.afternoonHalfOff) {
    return flags.morningHalfOff;
  }
  if (key === "nightUnavailable" && !flags.nightUnavailable) {
    return flags.morningHalfOff;
  }
  return false;
}

/** 保存データなどで矛盾があれば午前半休を優先して他を落とす */
export function sanitizeSameDayPreferenceFlags(
  flags: MemberDayPreferenceFlags,
): MemberDayPreferenceFlags {
  const f = { ...flags };
  if (f.morningHalfOff) {
    if (f.afternoonHalfOff) f.afternoonHalfOff = false;
    if (f.nightUnavailable) f.nightUnavailable = false;
  }
  return f;
}

export function wouldExceedPreferenceCap(
  key: PreferenceToggleKey,
  flagsByDate: Record<ISODateString, MemberDayPreferenceFlags>,
  year: number,
  month0: number,
  date: ISODateString,
  nextFlags: MemberDayPreferenceFlags,
  caps: EffectivePreferenceCaps,
): boolean {
  if (key === "fullDayOff" || key === "fullyUnavailable") {
    return countRestCrossMarksForFlags(flagsByDate, year, month0, date, nextFlags) > caps.restCross;
  }
  if (key === "morningHalfOff" || key === "afternoonHalfOff") {
    return (
      countHalfDayMarksForFlags(flagsByDate, year, month0, date, nextFlags) > caps.halfDay
    );
  }
  if (key === "nightUnavailable") {
    return countNightMarksForFlags(flagsByDate, year, month0, date, nextFlags) > caps.night;
  }
  return false;
}
