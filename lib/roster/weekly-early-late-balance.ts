import type { AdminSettings, DutyMember, ISODateString } from "@/types";
import { DUTY_MEMBER_RANK_ORDER_BY_MEMBER } from "@/types";
import { addDays, isWeekdayMonFri, weekdaySun0 } from "./dates";
import { compareForDutyCountAssignment } from "./duty-count-assignment";
import { holidayNameOn } from "./holidays";
import {
  isGraphExclusiveForIsobe,
  lookupCongressMonthly,
  lookupCongressWeekly,
} from "./slots";

const DUTY_MEMBERS: DutyMember[] = (
  Object.keys(DUTY_MEMBER_RANK_ORDER_BY_MEMBER) as DutyMember[]
).sort(
  (a, b) => DUTY_MEMBER_RANK_ORDER_BY_MEMBER[a] - DUTY_MEMBER_RANK_ORDER_BY_MEMBER[b],
);

/** その日を含む週の月曜日（月曜始まり）を週キーとする */
export function mondayWeekKey(iso: ISODateString): ISODateString {
  const w = weekdaySun0(iso);
  const daysBack = w === 0 ? 6 : w - 1;
  return addDays(iso, -daysBack);
}

export interface WeeklyEarlyLateCounts {
  weekKey: string;
  early: Record<DutyMember, number>;
  late: Record<DutyMember, number>;
}

export function createWeeklyEarlyLateCounts(): WeeklyEarlyLateCounts {
  const early = {} as Record<DutyMember, number>;
  const late = {} as Record<DutyMember, number>;
  for (const m of DUTY_MEMBERS) {
    early[m] = 0;
    late[m] = 0;
  }
  return { weekKey: "", early, late };
}

export function resetWeeklyEarlyLateCountsIfNewWeek(
  state: WeeklyEarlyLateCounts,
  date: ISODateString,
): void {
  const key = mondayWeekKey(date);
  if (state.weekKey === key) return;
  state.weekKey = key;
  for (const m of DUTY_MEMBERS) {
    state.early[m] = 0;
    state.late[m] = 0;
  }
}

/**
 * 週次の早番・遅番均等化の集計対象外（国会指名・グラフ専任・出向。早番・遅番には原則つけない）
 */
/** 候補のうち週次均等化の集計対象となる部員 */
export function membersInWeeklyEarlyLateBalanceScope(
  pool: DutyMember[],
  admin: AdminSettings,
  date: ISODateString,
  holidayMap: Record<ISODateString, string>,
): DutyMember[] {
  return pool.filter(
    (m) => !isExcludedFromWeeklyEarlyLateBalance(admin, date, m, holidayMap),
  );
}

/** 週内の当該枠（早番または遅番）で回数が最小の部員（均等化の最優先候補） */
export function weeklyMinimumKindMembersInPool(
  pool: DutyMember[],
  kind: "早番" | "遅番",
  weeklyEarly: Record<DutyMember, number>,
  weeklyLate: Record<DutyMember, number>,
  admin: AdminSettings,
  date: ISODateString,
  holidayMap: Record<ISODateString, string>,
): Set<DutyMember> {
  const weekly = kind === "早番" ? weeklyEarly : weeklyLate;
  const eligible = membersInWeeklyEarlyLateBalanceScope(
    pool,
    admin,
    date,
    holidayMap,
  );
  if (eligible.length === 0) return new Set();
  const min = Math.min(...eligible.map((m) => weekly[m] ?? 0));
  return new Set(
    eligible.filter((m) => (weekly[m] ?? 0) === min),
  );
}

function narrowPoolToMinimumCounts(
  pool: DutyMember[],
  counts: Record<DutyMember, number>,
  countBasis: DutyMember[],
): DutyMember[] {
  if (pool.length < 2 || countBasis.length === 0) return pool;
  const min = Math.min(...countBasis.map((m) => counts[m] ?? 0));
  const narrowed = pool.filter((m) => (counts[m] ?? 0) === min);
  return narrowed.length > 0 ? narrowed : pool;
}

/**
 * 週内の早番／遅番回数が最小の候補に絞る（他に候補がいる限り。均等化を最優先）。
 */
export function preferMinimumWeeklyEarlyLateInPool(
  pool: DutyMember[],
  kind: "早番" | "遅番",
  weeklyEarly: Record<DutyMember, number>,
  weeklyLate: Record<DutyMember, number>,
  admin: AdminSettings,
  date: ISODateString,
  holidayMap: Record<ISODateString, string>,
): DutyMember[] {
  const weekly = kind === "早番" ? weeklyEarly : weeklyLate;
  const eligible = membersInWeeklyEarlyLateBalanceScope(
    pool,
    admin,
    date,
    holidayMap,
  );
  return narrowPoolToMinimumCounts(pool, weekly, eligible);
}

/**
 * 期間内の早番／遅番回数が最小の候補に絞る（週次絞り込みの次に適用）。
 */
export function preferMinimumPeriodEarlyLateInPool(
  pool: DutyMember[],
  kind: "早番" | "遅番",
  periodEarly: Record<DutyMember, number>,
  periodLate: Record<DutyMember, number>,
): DutyMember[] {
  const counts = kind === "早番" ? periodEarly : periodLate;
  return narrowPoolToMinimumCounts(pool, counts, pool);
}

export function isExcludedFromWeeklyEarlyLateBalance(
  admin: AdminSettings,
  date: ISODateString,
  member: DutyMember,
  holidayMap: Record<ISODateString, string>,
): boolean {
  if (admin.secondmentByDutyMember[member] === "on_loan") return true;
  if (member === "磯田" && isGraphExclusiveForIsobe(admin, date)) return true;
  if (!isWeekdayMonFri(date)) return true;
  if (holidayNameOn(date, holidayMap)) return true;
  if (lookupCongressMonthly(admin, date) === member) return true;
  if (lookupCongressWeekly(admin, date) === member) return true;
  return false;
}

/**
 * 週内の早番・遅番をそれぞれ別枠として均等化するソート。
 * 早番は早番の週次回数のみ、遅番は遅番の週次回数のみで比較する（相互に合算しない）。
 */
export function compareForWeeklyEarlyLateAssignment(
  a: DutyMember,
  b: DutyMember,
  kind: "早番" | "遅番",
  weeklyEarly: Record<DutyMember, number>,
  weeklyLate: Record<DutyMember, number>,
  periodEarlyLate: Record<DutyMember, number>,
): number {
  const weekly =
    kind === "早番" ? weeklyEarly : weeklyLate;
  const wa = weekly[a] ?? 0;
  const wb = weekly[b] ?? 0;
  if (wa !== wb) return wa - wb;
  return compareForDutyCountAssignment(a, b, periodEarlyLate);
}

export function recordWeeklyEarlyLateAssignment(
  state: WeeklyEarlyLateCounts,
  member: DutyMember,
  kind: "早番" | "遅番",
): void {
  if (kind === "早番") {
    state.early[member] = (state.early[member] ?? 0) + 1;
  } else {
    state.late[member] = (state.late[member] ?? 0) + 1;
  }
}
