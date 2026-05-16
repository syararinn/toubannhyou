import type {
  AdminSettings,
  DailyAttendanceHeadcountOverride,
  DutyMember,
  ISODateString,
  NewspaperNonPublicationWorkDay,
  RosterColumnPerson,
} from "@/types";
import { mondayBasedWeekIndexInMonth, yearMonthFromIso } from "./congress-week";
import { eachDateInclusive, isSaturday, isSunday, isWeekdayMonFri, parseISODate } from "./dates";
import { holidayNameOn } from "./holidays";

export type DutySlotKind =
  | "早番"
  | "遅番"
  | "メイン"
  | "予備"
  | "国会週番"
  | "国会月番"
  /** 月番・週番の欠員時に無印メンバーへ割り当てる国会応援枠 */
  | "国会（応援）"
  | "国会";

export function isCongressSlotKind(kind: DutySlotKind): boolean {
  return (
    kind === "国会週番" ||
    kind === "国会月番" ||
    kind === "国会（応援）" ||
    kind === "国会"
  );
}

function isCongressKind(kind: DutySlotKind): boolean {
  return isCongressSlotKind(kind);
}

/** 勤務間インターバル・午後半休判定用の「遅番側」相当（夜✖️の可否とは別。夜✖️は eligibility で日付付き判定） */
export function slotIsLateLike(kind: DutySlotKind): boolean {
  return kind === "遅番" || kind === "予備" || isCongressKind(kind);
}

/** 勤務間インターバル判定に使う「早番側」相当の枠 */
export function slotIsEarlyLike(kind: DutySlotKind): boolean {
  return kind === "早番" || kind === "メイン";
}

export interface DemandSlot {
  /** 同一日内で一意 */
  id: string;
  kind: DutySlotKind;
  /** 国会当番など、管理者が指定した部員に固定（未指定なら自動割当対象として欠員扱い） */
  fixedAssignee?: DutyMember;
}

export function lookupCongressMonthly(
  admin: AdminSettings,
  iso: ISODateString,
): DutyMember | undefined {
  const ym = yearMonthFromIso(iso);
  return admin.congressMonthlyAssignments.find((a) => a.yearMonth === ym)?.dutyMember;
}

export function lookupCongressWeekly(
  admin: AdminSettings,
  iso: ISODateString,
): DutyMember | undefined {
  const ym = yearMonthFromIso(iso);
  const wk = mondayBasedWeekIndexInMonth(iso);
  return admin.congressWeeklyAssignments.find(
    (a) => a.yearMonth === ym && a.weekIndexInMonth === wk,
  )?.dutyMember;
}

function findOverride(
  admin: AdminSettings,
  date: ISODateString,
): DailyAttendanceHeadcountOverride | undefined {
  return admin.dailyAttendanceOverrides.find((o) => o.date === date);
}

export function isInAnyDietSession(admin: AdminSettings, date: ISODateString): boolean {
  return admin.dietSessions.some((p) => date >= p.start && date <= p.end);
}

/**
 * その日と同じ「月内週ブロック」の平日のうち、いずれかが国会会期に含まれるか。
 * 会期が週の途中から始まる場合でも、その週の月曜（会期前）から週番枠を出すために使う。
 */
export function weekBlockIntersectsDietSession(
  admin: AdminSettings,
  iso: ISODateString,
): boolean {
  if (!isWeekdayMonFri(iso)) return false;
  const { y, m } = parseISODate(iso);
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  const lastD = new Date(y, m, 0).getDate();
  const monthStart = `${y}-${pad(m)}-01`;
  const monthEnd = `${y}-${pad(m)}-${pad(lastD)}`;
  const wk = mondayBasedWeekIndexInMonth(iso);
  for (const d of eachDateInclusive(monthStart, monthEnd)) {
    if (!isWeekdayMonFri(d)) continue;
    if (mondayBasedWeekIndexInMonth(d) !== wk) continue;
    if (isInAnyDietSession(admin, d)) return true;
  }
  return false;
}

export function getNewspaperWorkDay(
  admin: AdminSettings,
  date: ISODateString,
): NewspaperNonPublicationWorkDay | undefined {
  return admin.newspaperNonPublicationWorkDays.find((d) => d.date === date);
}

export function isNewspaperNonPublicationDay(
  admin: AdminSettings,
  date: ISODateString,
): boolean {
  return getNewspaperWorkDay(admin, date) !== undefined;
}

/** 新聞休刊作業日の出勤セルに印字する文言 */
export const NEWSPAPER_WORKDAY_CELL_LABEL = "出勤";

/**
 * 休刊作業日に 1 名だけ指定されている場合、その人の列に「出勤」を出す（行事列には名前を出さない）。
 */
export function applyNewspaperWorkdayAssigneeCell(
  draft: Record<RosterColumnPerson, string>,
  admin: AdminSettings,
  date: ISODateString,
): Record<RosterColumnPerson, string> {
  const row = getNewspaperWorkDay(admin, date);
  if (!row?.assignee) return draft;
  const out = { ...draft };
  out[row.assignee] = NEWSPAPER_WORKDAY_CELL_LABEL;
  return out;
}

export function isGraphExclusiveForIsobe(admin: AdminSettings, date: ISODateString): boolean {
  return admin.graphExclusivePeriodsForIsobe.some(
    (r) => date >= r.start && date <= r.end,
  );
}

/**
 * 指定日に必要な当番枠（順序は割当ループでそのまま使用）
 */
export function buildDemandSlotsForDate(
  admin: AdminSettings,
  date: ISODateString,
  holidayExtra: Record<ISODateString, string>,
): DemandSlot[] {
  const slots: DemandSlot[] = [];
  const ov = findOverride(admin, date);
  const hol = holidayNameOn(date, holidayExtra);
  const isHol = Boolean(hol);

  /** 休刊作業日は自動当番（メイン／予備等）を出さない。出勤は管理者指定の 1 名のみ。 */
  if (isNewspaperNonPublicationDay(admin, date)) {
    return [];
  }

  if (isSunday(date) || isHol) {
    const mainN = ov?.weekendHolidaySlots?.sundayOrHolidayMain ?? 1;
    const resN = ov?.weekendHolidaySlots?.sundayOrHolidayReserve ?? 1;

    for (let i = 0; i < mainN; i++) {
      slots.push({ id: `main-${i}`, kind: "メイン" });
    }
    for (let i = 0; i < resN; i++) {
      slots.push({ id: `res-${i}`, kind: "予備" });
    }
    return slots;
  }

  if (isWeekdayMonFri(date)) {
    const earlyN = ov?.weekdaySlots?.early ?? 1;
    const lateN = ov?.weekdaySlots?.late ?? 1;
    const monthly = lookupCongressMonthly(admin, date);
    const inDietToday = isInAnyDietSession(admin, date);
    const weekly = lookupCongressWeekly(admin, date);
    const twoSeatCongressDay = inDietToday || weekBlockIntersectsDietSession(admin, date);
    for (let i = 0; i < earlyN; i++) {
      slots.push({ id: `early-${i}`, kind: "早番" });
    }
    for (let i = 0; i < lateN; i++) {
      slots.push({ id: `late-${i}`, kind: "遅番" });
    }
    if (twoSeatCongressDay) {
      slots.push({
        id: "congress-month",
        kind: "国会月番",
        fixedAssignee: monthly,
      });
      slots.push({
        id: "congress-week",
        kind: "国会週番",
        fixedAssignee: weekly,
      });
    } else {
      slots.push({
        id: "congress-month-recess",
        kind: "国会月番",
        fixedAssignee: monthly,
      });
    }
    return slots;
  }

  if (isSaturday(date)) {
    const sat = ov?.weekendHolidaySlots?.saturdayTotal ?? 1;
    for (let i = 0; i < sat; i++) {
      slots.push({ id: `sat-${i}`, kind: "メイン" });
    }
    return slots;
  }

  return slots;
}

/** 行事（表では C 列に統合表示）。国会会期・グラフ専任はセルに出さず、当番割当／磯田列で表現する。 */
export function buildEventsColumnText(
  admin: AdminSettings,
  date: ISODateString,
  holidayExtra: Record<ISODateString, string>,
): string {
  const parts: string[] = [];
  const hol = holidayNameOn(date, holidayExtra);
  if (hol) parts.push(hol);
  if (getNewspaperWorkDay(admin, date)) {
    parts.push("新聞休刊作業日");
  }
  return parts.join("／");
}
