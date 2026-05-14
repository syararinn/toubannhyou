import type {
  AdminSettings,
  DailyAttendanceHeadcountOverride,
  DutyMember,
  ISODateString,
} from "@/types";
import { mondayBasedWeekIndexInMonth, yearMonthFromIso } from "./congress-week";
import { isSaturday, isSunday, isWeekdayMonFri } from "./dates";
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

function isCongressKind(kind: DutySlotKind): boolean {
  return (
    kind === "国会週番" ||
    kind === "国会月番" ||
    kind === "国会（応援）" ||
    kind === "国会"
  );
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

export function isNewspaperNonPublicationDay(
  admin: AdminSettings,
  date: ISODateString,
): boolean {
  return admin.newspaperNonPublicationWorkDates.includes(date);
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

  if (isSunday(date) || isHol) {
    const np = isNewspaperNonPublicationDay(admin, date);
    const reduceReserve = np && (isSunday(date) || isHol);

    const mainN = ov?.weekendHolidaySlots?.sundayOrHolidayMain ?? 1;
    const resN =
      ov?.weekendHolidaySlots?.sundayOrHolidayReserve ?? (reduceReserve ? 0 : 1);

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
    const inDiet = isInAnyDietSession(admin, date);
    for (let i = 0; i < earlyN; i++) {
      slots.push({ id: `early-${i}`, kind: "早番" });
    }
    for (let i = 0; i < lateN; i++) {
      slots.push({ id: `late-${i}`, kind: "遅番" });
    }
    if (inDiet) {
      const weekly = lookupCongressWeekly(admin, date);
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

export function buildEventsColumnText(
  admin: AdminSettings,
  date: ISODateString,
  holidayExtra: Record<ISODateString, string>,
): string {
  const parts: string[] = [];
  const hol = holidayNameOn(date, holidayExtra);
  if (hol) parts.push(hol);
  if (isInAnyDietSession(admin, date)) parts.push("国会会期中");
  if (isNewspaperNonPublicationDay(admin, date)) parts.push("新聞休刊作業日");
  if (isGraphExclusiveForIsobe(admin, date)) parts.push("グラフ専任（磯田）");
  return parts.join("／");
}
