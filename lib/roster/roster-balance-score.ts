import type { AdminSettings, DutyMember, GeneratedRosterDay, ISODateString } from "@/types";
import { DUTY_MEMBER_RANK_ORDER_BY_MEMBER } from "@/types";
import { isWeekdayMonFri } from "./dates";
import { holidayNameOn } from "./holidays";
import type { DutySlotKind } from "./slots";

export interface RosterUnfilledSlot {
  date: ISODateString;
  slotId: string;
  kind: DutySlotKind;
}
import {
  isExcludedFromWeeklyEarlyLateBalance,
  mondayWeekKey,
} from "./weekly-early-late-balance";

const DUTY_MEMBERS: DutyMember[] = Object.keys(
  DUTY_MEMBER_RANK_ORDER_BY_MEMBER,
) as DutyMember[];

function cellIncludesKind(cell: string, kind: "早番" | "遅番"): boolean {
  if (!cell) return false;
  if (kind === "早番") return cell.includes("早番");
  return cell.includes("遅番");
}

function spreadScore(counts: Record<DutyMember, number>, members: DutyMember[]): number {
  if (members.length < 2) return 0;
  let min = Infinity;
  let max = -Infinity;
  for (const m of members) {
    const c = counts[m] ?? 0;
    if (c < min) min = c;
    if (c > max) max = c;
  }
  const diff = max - min;
  return diff * diff * 10 + diff * 5;
}

/**
 * 期間全体で、部員ごとの「早番回数＋遅番回数」の偏り（国会はセルに早/遅として含まれない）。
 */
export function scoreMonthlyEarlyLateCombinedSpread(days: GeneratedRosterDay[]): number {
  const periodEarly = {} as Record<DutyMember, number>;
  const periodLate = {} as Record<DutyMember, number>;
  for (const m of DUTY_MEMBERS) {
    periodEarly[m] = 0;
    periodLate[m] = 0;
  }

  for (const day of days) {
    for (const m of DUTY_MEMBERS) {
      const cell = day.rosterCellsByColumnPerson[m as keyof typeof day.rosterCellsByColumnPerson] ?? "";
      if (cellIncludesKind(cell, "早番")) {
        periodEarly[m] += 1;
      }
      if (cellIncludesKind(cell, "遅番")) {
        periodLate[m] += 1;
      }
    }
  }

  const combined = {} as Record<DutyMember, number>;
  for (const m of DUTY_MEMBERS) {
    combined[m] = (periodEarly[m] ?? 0) + (periodLate[m] ?? 0);
  }
  return spreadScore(combined, DUTY_MEMBERS);
}

/** 週次・期間の早番／遅番偏りと未充足枠からスコア（小さいほど均等） */
export function scoreRosterEarlyLateBalance(
  days: GeneratedRosterDay[],
  rangeStart: ISODateString,
  rangeEnd: ISODateString,
  admin: AdminSettings,
  hol: Record<ISODateString, string>,
  unfilled: RosterUnfilledSlot[],
): number {
  const periodEarly = {} as Record<DutyMember, number>;
  const periodLate = {} as Record<DutyMember, number>;
  for (const m of DUTY_MEMBERS) {
    periodEarly[m] = 0;
    periodLate[m] = 0;
  }

  const weeklyByKey = new Map<
    string,
    { early: Record<DutyMember, number>; late: Record<DutyMember, number> }
  >();

  for (const day of days) {
    const date = day.date;
    const wk = mondayWeekKey(date);
    if (!weeklyByKey.has(wk)) {
      const early = {} as Record<DutyMember, number>;
      const late = {} as Record<DutyMember, number>;
      for (const m of DUTY_MEMBERS) {
        early[m] = 0;
        late[m] = 0;
      }
      weeklyByKey.set(wk, { early, late });
    }
    const week = weeklyByKey.get(wk)!;

    for (const m of DUTY_MEMBERS) {
      const cell = day.rosterCellsByColumnPerson[m as keyof typeof day.rosterCellsByColumnPerson] ?? "";
      if (cellIncludesKind(cell, "早番")) {
        periodEarly[m] += 1;
        if (
          isWeekdayMonFri(date) &&
          !holidayNameOn(date, hol) &&
          !isExcludedFromWeeklyEarlyLateBalance(admin, date, m, hol)
        ) {
          week.early[m] += 1;
        }
      }
      if (cellIncludesKind(cell, "遅番")) {
        periodLate[m] += 1;
        if (
          isWeekdayMonFri(date) &&
          !holidayNameOn(date, hol) &&
          !isExcludedFromWeeklyEarlyLateBalance(admin, date, m, hol)
        ) {
          week.late[m] += 1;
        }
      }
    }
  }

  let score = 0;

  for (const { early, late } of weeklyByKey.values()) {
    score += spreadScore(early, DUTY_MEMBERS);
    score += spreadScore(late, DUTY_MEMBERS);
  }

  score += spreadScore(periodEarly, DUTY_MEMBERS);
  score += spreadScore(periodLate, DUTY_MEMBERS);
  score += unfilled.length * 1000;

  return score;
}
