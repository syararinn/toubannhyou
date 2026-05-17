import type {
  AdminSettings,
  DutyMember,
  GeneratedRosterDay,
  ISODateString,
  MemberPreferenceInput,
  RosterColumnPerson,
} from "@/types";
import { DUTY_MEMBER_RANK_ORDER_BY_MEMBER, DUTY_MEMBER_RANK_PRIORITY_ORDER, ROSTER_COLUMN_ORDER } from "@/types";
import {
  addDays,
  eachDateInclusive,
  isSaturday,
  isSunday,
  isWeekdayMonFri,
  weekdayLabelJa,
} from "./dates";
import {
  compareForAssignment,
  getFlags,
  isMemberExcludedGlobally,
  preferencesToMap,
  type PreferenceMap,
  hadLateShiftYesterday,
  violatesHardPreference,
  violatesInterval,
  violatesMorningHalfOnLateSlot,
} from "./eligibility";
import { buildHolidayLookupMap, holidayNameOn } from "./holidays";
import { applyCongressNominationCellLabels } from "./congress-nomination-display";
import { yearMonthFromIso } from "./congress-week";
import { applyGraphExclusiveIsobeCellLabel } from "./graph-exclusive-display";
import { formatPreferenceMarksForDay } from "./preference-marks";
import { appendSupplementalCongressOuenSlots } from "./congress-supplement-slots";
import {
  applyNewspaperWorkdayAssigneeCell,
  buildDemandSlotsForDate,
  buildEventsColumnText,
  type DemandSlot,
  type DutySlotKind,
  isBlockedFromWeekdayEarlyLateDueToCongressNomination,
  lookupCongressMonthly,
  lookupCongressWeekly,
} from "./slots";
import {
  createEarlyLateDutyCounts,
  recordEarlyLateDutyAssignment,
  type EarlyLateDutyCounts,
} from "./early-late-duty-counts";
import {
  scoreMonthlyEarlyLateCombinedSpread,
  scoreRosterEarlyLateBalance,
} from "./roster-balance-score";
import {
  createWeeklyEarlyLateCounts,
  isExcludedFromWeeklyEarlyLateBalance,
  recordWeeklyEarlyLateAssignment,
  resetWeeklyEarlyLateCountsIfNewWeek,
  type WeeklyEarlyLateCounts,
} from "./weekly-early-late-balance";

const DUTY_MEMBERS: DutyMember[] = (
  Object.keys(DUTY_MEMBER_RANK_ORDER_BY_MEMBER) as DutyMember[]
).sort(
  (a, b) => DUTY_MEMBER_RANK_ORDER_BY_MEMBER[a] - DUTY_MEMBER_RANK_ORDER_BY_MEMBER[b],
);

/** 休日のメイン／予備を月単位で部員ごとに近づける（同数なら補助枠カウンタでタイブレーク）。 */
function compareForMonthlyHolidayMainOrReserve(
  a: DutyMember,
  b: DutyMember,
  slotKind: DutySlotKind,
  monthlyMain: Record<DutyMember, number>,
  monthlyReserve: Record<DutyMember, number>,
  auxiliaryDutyCounts: Record<DutyMember, number>,
): number {
  if (slotKind === "メイン") {
    const c = compareForAssignment(a, b, monthlyMain);
    if (c !== 0) return c;
    return compareForAssignment(a, b, auxiliaryDutyCounts);
  }
  if (slotKind === "予備") {
    const c = compareForAssignment(a, b, monthlyReserve);
    if (c !== 0) return c;
    return compareForAssignment(a, b, auxiliaryDutyCounts);
  }
  return compareForAssignment(a, b, auxiliaryDutyCounts);
}

export interface GenerateRosterInput {
  admin: AdminSettings;
  rangeStart: ISODateString;
  rangeEnd: ISODateString;
  holidaysExtra?: Record<ISODateString, string>;
  preferencesByMember: Partial<Record<DutyMember, MemberPreferenceInput>>;
}

export interface UnfilledSlot {
  date: ISODateString;
  slotId: string;
  kind: DutySlotKind;
}

function mergeHolidayMap(
  admin: AdminSettings,
  extra?: Record<ISODateString, string>,
): Record<ISODateString, string> {
  return buildHolidayLookupMap(admin, extra);
}

function emptyCells(): Record<RosterColumnPerson, string> {
  const row = {} as Record<RosterColumnPerson, string>;
  for (const p of ROSTER_COLUMN_ORDER) {
    row[p] = "";
  }
  return row;
}

function mergeDutyLabel(prev: string, next: string): string {
  return prev ? `${prev}・${next}` : next;
}

function tryAssignFixedSlot(
  pick: DutyMember,
  slot: DemandSlot,
  date: ISODateString,
  admin: AdminSettings,
  prefsMap: Record<DutyMember, PreferenceMap>,
  assignedToday: Partial<Record<DutyMember, DutySlotKind>>,
  yesterdayKind: Partial<Record<DutyMember, DutySlotKind>>,
  cells: Record<RosterColumnPerson, string>,
  auxiliaryDutyCounts: Record<DutyMember, number>,
  allowSoftMorningOnLate: boolean,
  holidayMap: Record<ISODateString, string>,
): boolean {
  if (isMemberExcludedGlobally(admin, pick, date)) return false;
  if (assignedToday[pick] !== undefined) return false;
  const flags = getFlags(prefsMap[pick], date);
  if (violatesHardPreference(flags, slot.kind, date, holidayMap)) return false;
  if (violatesInterval(slot.kind, yesterdayKind, pick)) return false;
  if (!allowSoftMorningOnLate && violatesMorningHalfOnLateSlot(flags, slot.kind)) {
    return false;
  }
  assignedToday[pick] = slot.kind;
  auxiliaryDutyCounts[pick] = (auxiliaryDutyCounts[pick] ?? 0) + 1;
  const prev = cells[pick] ?? "";
  cells[pick] = mergeDutyLabel(prev, slot.kind);
  return true;
}

const CONGRESS_OUEN_KIND: DutySlotKind = "国会（応援）";

/**
 * 国会欠員の応援枠: 月番・週番の指名者（無印以外）には割り当てない。
 * その日すでに早番・遅番の者も対象外（早番・遅番を優先）。
 */
function buildCongressOuenPool(
  date: ISODateString,
  admin: AdminSettings,
  prefsMap: Record<DutyMember, PreferenceMap>,
  assignedToday: Partial<Record<DutyMember, DutySlotKind>>,
  yesterdayKind: Partial<Record<DutyMember, DutySlotKind>>,
  hol: Record<ISODateString, string>,
  allowSoftMorningOnLate: boolean,
): DutyMember[] {
  return DUTY_MEMBERS.filter((m) => {
    if (isMemberExcludedGlobally(admin, m, date)) return false;
    if (lookupCongressMonthly(admin, date) === m) return false;
    if (lookupCongressWeekly(admin, date) === m) return false;
    const k = assignedToday[m];
    if (k === "早番" || k === "遅番") return false;
    if (k !== undefined) return false;
    const flags = getFlags(prefsMap[m], date);
    if (violatesHardPreference(flags, CONGRESS_OUEN_KIND, date, hol)) return false;
    if (violatesInterval(CONGRESS_OUEN_KIND, yesterdayKind, m)) return false;
    if (!allowSoftMorningOnLate && violatesMorningHalfOnLateSlot(flags, CONGRESS_OUEN_KIND)) {
      return false;
    }
    return true;
  });
}

function isDemandCongressSlotKind(kind: DutySlotKind): boolean {
  return kind === "国会月番" || kind === "国会週番" || kind === "国会";
}

function tryAssignCongressWithOuenFallback(
  slot: DemandSlot,
  date: ISODateString,
  admin: AdminSettings,
  prefsMap: Record<DutyMember, PreferenceMap>,
  assignedToday: Partial<Record<DutyMember, DutySlotKind>>,
  yesterdayKind: Partial<Record<DutyMember, DutySlotKind>>,
  cells: Record<RosterColumnPerson, string>,
  auxiliaryDutyCounts: Record<DutyMember, number>,
  hol: Record<ISODateString, string>,
  unfilled: UnfilledSlot[] | undefined,
): boolean {
  const fix = slot.fixedAssignee;
  if (fix === undefined) {
    if (unfilled) unfilled.push({ date, slotId: slot.id, kind: slot.kind });
    return false;
  }

  if (getFlags(prefsMap[fix], date).fullDayOff) {
    cells[fix] = "休";
  }

  let placed = false;
  if (!getFlags(prefsMap[fix], date).fullDayOff) {
    placed =
      tryAssignFixedSlot(
        fix,
        slot,
        date,
        admin,
        prefsMap,
        assignedToday,
        yesterdayKind,
        cells,
        auxiliaryDutyCounts,
        false,
        hol,
      ) ||
      tryAssignFixedSlot(
        fix,
        slot,
        date,
        admin,
        prefsMap,
        assignedToday,
        yesterdayKind,
        cells,
        auxiliaryDutyCounts,
        true,
        hol,
      );
  }

  if (placed) return true;

  const ouenSlot: DemandSlot = { id: `${slot.id}-ouen`, kind: CONGRESS_OUEN_KIND };
  let pool = buildCongressOuenPool(date, admin, prefsMap, assignedToday, yesterdayKind, hol, false);
  if (pool.length === 0) {
    pool = buildCongressOuenPool(date, admin, prefsMap, assignedToday, yesterdayKind, hol, true);
  }
  if (pool.length === 0) {
    if (unfilled) unfilled.push({ date, slotId: slot.id, kind: slot.kind });
    return false;
  }
  pool.sort((a, b) => compareForAssignment(a, b, auxiliaryDutyCounts));
  for (const m of pool) {
    if (
      tryAssignFixedSlot(
        m,
        ouenSlot,
        date,
        admin,
        prefsMap,
        assignedToday,
        yesterdayKind,
        cells,
        auxiliaryDutyCounts,
        false,
        hol,
      )
    ) {
      return true;
    }
    if (
      tryAssignFixedSlot(
        m,
        ouenSlot,
        date,
        admin,
        prefsMap,
        assignedToday,
        yesterdayKind,
        cells,
        auxiliaryDutyCounts,
        true,
        hol,
      )
    ) {
      return true;
    }
  }
  if (unfilled) unfilled.push({ date, slotId: slot.id, kind: slot.kind });
  return false;
}

function isRestDay(
  date: ISODateString,
  holidayMap: Record<ISODateString, string>,
): boolean {
  return isSaturday(date) || isSunday(date) || Boolean(holidayNameOn(date, holidayMap));
}

/** 休日（土・日・祝）のメイン／予備出勤の連続を原則避ける（他に候補がいる限り）。 */
function hadRestDayAttendanceYesterday(
  member: DutyMember,
  date: ISODateString,
  yesterdayKind: Partial<Record<DutyMember, DutySlotKind>>,
  holidayMap: Record<ISODateString, string>,
): boolean {
  const yesterday = addDays(date, -1);
  if (!isRestDay(yesterday, holidayMap)) return false;
  const k = yesterdayKind[member];
  return k === "メイン" || k === "予備";
}

function preferAvoidConsecutiveRestDayAttendance(
  pool: DutyMember[],
  slotKind: DutySlotKind,
  date: ISODateString,
  yesterdayKind: Partial<Record<DutyMember, DutySlotKind>>,
  holidayMap: Record<ISODateString, string>,
): DutyMember[] {
  if (!isRestDay(date, holidayMap)) return pool;
  if (slotKind !== "メイン" && slotKind !== "予備") return pool;
  const without = pool.filter(
    (m) => !hadRestDayAttendanceYesterday(m, date, yesterdayKind, holidayMap),
  );
  return without.length > 0 ? without : pool;
}

/** 日曜・祝日のメイン出勤の翌日は早番を原則つけない（他に候補がいる限り）。 */
function hadSunOrHolidayMainYesterday(
  member: DutyMember,
  date: ISODateString,
  yesterdayKind: Partial<Record<DutyMember, DutySlotKind>>,
  holidayMap: Record<ISODateString, string>,
): boolean {
  if (yesterdayKind[member] !== "メイン") return false;
  const yesterday = addDays(date, -1);
  return isSunday(yesterday) || Boolean(holidayNameOn(yesterday, holidayMap));
}

function preferFilterKeepingWeeklyMin(
  pool: DutyMember[],
  weeklyMinGuard: Set<DutyMember> | undefined,
  keep: (m: DutyMember) => boolean,
): DutyMember[] {
  const filtered = pool.filter(keep);
  if (filtered.length === 0) return pool;
  if (
    weeklyMinGuard &&
    weeklyMinGuard.size > 0 &&
    !filtered.some((m) => weeklyMinGuard.has(m))
  ) {
    return pool;
  }
  return filtered;
}

/** 前日が遅番・予備の部員は早番を原則つけない（国会翌日は可。他に候補がいる限り）。 */
function preferAvoidEarlyAfterLateShift(
  pool: DutyMember[],
  slotKind: DutySlotKind,
  yesterdayKind: Partial<Record<DutyMember, DutySlotKind>>,
): DutyMember[] {
  if (slotKind !== "早番") return pool;
  const without = pool.filter((m) => !hadLateShiftYesterday(yesterdayKind, m));
  return without.length > 0 ? without : pool;
}

/** 月次（早＋遅合算）の均等化を試すための再試行回数。7 で序列ローテーションが一周。 */
const ROSTER_GENERATION_MAX_ATTEMPTS = 28;
/** この回数連続で合成スコアが改善しなければ打切り */
const ROSTER_RETRY_STALE_ATTEMPTS = 5;

/**
 * 同日の demand スロット割当 DFS の訪問ノード上限。
 * 超えた時点で、これまでに見つかった「欠員数が最少」の案を採用する（要件の「30回」では実務上不足のため数千規模）。
 */
const MAX_DAY_ASSIGNMENT_SEARCH_NODES = 5000;

/**
 * 週次・期間回数・ソフト優先がすべて同点のときの序列タイブレーク。
 * `rotation === 0` で要件【5】の本序列（中嶋→…→磯田）。
 * `rotation > 0` では序列起点をローテーションし、月単位の早＋遅偏りを減らす別解を探索する。
 */
function rotatedRankTieCompare(a: DutyMember, b: DutyMember, rotation: number): number {
  const pa = (DUTY_MEMBER_RANK_ORDER_BY_MEMBER[a] - 1 + rotation) % 7;
  const pb = (DUTY_MEMBER_RANK_ORDER_BY_MEMBER[b] - 1 + rotation) % 7;
  return pa - pb;
}

function compareWithTieBreak(
  baseCompare: (a: DutyMember, b: DutyMember) => number,
  a: DutyMember,
  b: DutyMember,
  rankTieRotationAttempt: number,
): number {
  const c = baseCompare(a, b);
  if (c !== 0) return c;
  return rotatedRankTieCompare(a, b, rankTieRotationAttempt);
}

/**
 * 早番・遅番の DFS で試す順序。ハード適合後のプールを要件【5】の序列下位→上位で並べる。
 * `rankTieRotationAttempt` は月次再試行で起点をローテーションする。
 */
function sortedEarlyLateCandidatesByRankPriority(
  pool: DutyMember[],
  rankTieRotationAttempt: number,
): DutyMember[] {
  const r = ((rankTieRotationAttempt % 7) + 7) % 7;
  const rotated: DutyMember[] = [
    ...DUTY_MEMBER_RANK_PRIORITY_ORDER.slice(r),
    ...DUTY_MEMBER_RANK_PRIORITY_ORDER.slice(0, r),
  ];
  return rotated.filter((m) => pool.includes(m));
}

/** 日曜・祝日のメイン出勤の翌日は早番を原則つけない（他に候補がいる限り）。 */
function preferAvoidEarlyAfterSunHolidayMain(
  pool: DutyMember[],
  slotKind: DutySlotKind,
  date: ISODateString,
  yesterdayKind: Partial<Record<DutyMember, DutySlotKind>>,
  holidayMap: Record<ISODateString, string>,
): DutyMember[] {
  if (slotKind !== "早番") return pool;
  const without = pool.filter(
    (m) => !hadSunOrHolidayMainYesterday(m, date, yesterdayKind, holidayMap),
  );
  return without.length > 0 ? without : pool;
}

/** 前日も早番だった部員は、同日早番の候補から外す（他に候補がいる限り）。 */
function preferAvoidConsecutiveEarlyShift(
  pool: DutyMember[],
  slotKind: DutySlotKind,
  yesterdayKind: Partial<Record<DutyMember, DutySlotKind>>,
  weeklyMinGuard?: Set<DutyMember>,
): DutyMember[] {
  if (slotKind !== "早番") return pool;
  return preferFilterKeepingWeeklyMin(
    pool,
    weeklyMinGuard,
    (m) => yesterdayKind[m] !== "早番",
  );
}

/** 前日も遅番だった部員は、同日遅番の候補から外す（他に候補がいる限り）。 */
function preferAvoidConsecutiveLateShift(
  pool: DutyMember[],
  slotKind: DutySlotKind,
  yesterdayKind: Partial<Record<DutyMember, DutySlotKind>>,
  weeklyMinGuard?: Set<DutyMember>,
): DutyMember[] {
  if (slotKind !== "遅番") return pool;
  return preferFilterKeepingWeeklyMin(
    pool,
    weeklyMinGuard,
    (m) => yesterdayKind[m] !== "遅番",
  );
}

/** 日曜・祝日の予備は夜✖️の人を避ける（他に候補がいる限り）。土曜は予備枠がない想定。 */
function preferNonNightForSundayHolidayReserve(
  pool: DutyMember[],
  slotKind: DutySlotKind,
  date: ISODateString,
  prefsMap: Record<DutyMember, PreferenceMap>,
  holidayMap: Record<ISODateString, string>,
): DutyMember[] {
  if (slotKind !== "予備") return pool;
  const sunOrHol = isSunday(date) || Boolean(holidayNameOn(date, holidayMap));
  if (!sunOrHol) return pool;
  const withoutNight = pool.filter((m) => !getFlags(prefsMap[m], date).nightUnavailable);
  return withoutNight.length > 0 ? withoutNight : pool;
}

/** 1 日分の探索でクローンするカウンタ・セル状態 */
interface DayAssignmentSearchState {
  assignedToday: Partial<Record<DutyMember, DutySlotKind>>;
  cells: Record<RosterColumnPerson, string>;
  auxiliaryDutyCounts: Record<DutyMember, number>;
  earlyLateDutyCounts: EarlyLateDutyCounts;
  monthlyHolidayMainCounts: Record<DutyMember, number>;
  monthlyHolidayReserveCounts: Record<DutyMember, number>;
  weeklyEarlyLate: WeeklyEarlyLateCounts;
}

function cloneDayAssignmentSearchState(s: DayAssignmentSearchState): DayAssignmentSearchState {
  return {
    assignedToday: { ...s.assignedToday },
    cells: { ...s.cells },
    auxiliaryDutyCounts: { ...s.auxiliaryDutyCounts },
    earlyLateDutyCounts: {
      early: { ...s.earlyLateDutyCounts.early },
      late: { ...s.earlyLateDutyCounts.late },
    },
    monthlyHolidayMainCounts: { ...s.monthlyHolidayMainCounts },
    monthlyHolidayReserveCounts: { ...s.monthlyHolidayReserveCounts },
    weeklyEarlyLate: {
      weekKey: s.weeklyEarlyLate.weekKey,
      early: { ...s.weeklyEarlyLate.early },
      late: { ...s.weeklyEarlyLate.late },
    },
  };
}

function createDaySearchStateFromGlobals(
  cellsSeed: Record<RosterColumnPerson, string>,
  auxiliaryDutyCounts: Record<DutyMember, number>,
  earlyLateDutyCounts: EarlyLateDutyCounts,
  monthlyHolidayMainCounts: Record<DutyMember, number>,
  monthlyHolidayReserveCounts: Record<DutyMember, number>,
  weeklyEarlyLate: WeeklyEarlyLateCounts,
): DayAssignmentSearchState {
  return {
    assignedToday: {},
    cells: { ...cellsSeed },
    auxiliaryDutyCounts: { ...auxiliaryDutyCounts },
    earlyLateDutyCounts: {
      early: { ...earlyLateDutyCounts.early },
      late: { ...earlyLateDutyCounts.late },
    },
    monthlyHolidayMainCounts: { ...monthlyHolidayMainCounts },
    monthlyHolidayReserveCounts: { ...monthlyHolidayReserveCounts },
    weeklyEarlyLate: {
      weekKey: weeklyEarlyLate.weekKey,
      early: { ...weeklyEarlyLate.early },
      late: { ...weeklyEarlyLate.late },
    },
  };
}

function commitDaySearchStateToGlobals(
  best: DayAssignmentSearchState,
  auxiliaryDutyCounts: Record<DutyMember, number>,
  earlyLateDutyCounts: EarlyLateDutyCounts,
  monthlyHolidayMainCounts: Record<DutyMember, number>,
  monthlyHolidayReserveCounts: Record<DutyMember, number>,
  weeklyEarlyLate: WeeklyEarlyLateCounts,
): void {
  weeklyEarlyLate.weekKey = best.weeklyEarlyLate.weekKey;
  for (const m of DUTY_MEMBERS) {
    auxiliaryDutyCounts[m] = best.auxiliaryDutyCounts[m] ?? 0;
    earlyLateDutyCounts.early[m] = best.earlyLateDutyCounts.early[m] ?? 0;
    earlyLateDutyCounts.late[m] = best.earlyLateDutyCounts.late[m] ?? 0;
    monthlyHolidayMainCounts[m] = best.monthlyHolidayMainCounts[m] ?? 0;
    monthlyHolidayReserveCounts[m] = best.monthlyHolidayReserveCounts[m] ?? 0;
    weeklyEarlyLate.early[m] = best.weeklyEarlyLate.early[m] ?? 0;
    weeklyEarlyLate.late[m] = best.weeklyEarlyLate.late[m] ?? 0;
  }
}

function applyVariableSlotToSearchState(
  state: DayAssignmentSearchState,
  slot: DemandSlot,
  pick: DutyMember,
  admin: AdminSettings,
  date: ISODateString,
  hol: Record<ISODateString, string>,
): void {
  state.assignedToday[pick] = slot.kind;
  if (slot.kind === "早番" || slot.kind === "遅番") {
    recordEarlyLateDutyAssignment(state.earlyLateDutyCounts, pick, slot.kind);
  } else {
    state.auxiliaryDutyCounts[pick] = (state.auxiliaryDutyCounts[pick] ?? 0) + 1;
    if (slot.kind === "メイン") {
      state.monthlyHolidayMainCounts[pick] = (state.monthlyHolidayMainCounts[pick] ?? 0) + 1;
    } else if (slot.kind === "予備") {
      state.monthlyHolidayReserveCounts[pick] =
        (state.monthlyHolidayReserveCounts[pick] ?? 0) + 1;
    }
  }
  if (
    (slot.kind === "早番" || slot.kind === "遅番") &&
    !isExcludedFromWeeklyEarlyLateBalance(admin, date, pick, hol)
  ) {
    recordWeeklyEarlyLateAssignment(state.weeklyEarlyLate, pick, slot.kind);
  }
  const prev = state.cells[pick] ?? "";
  state.cells[pick] = mergeDutyLabel(prev, slot.kind);
}

function buildSortedCandidatePoolForVariableSlot(
  slot: DemandSlot,
  date: ISODateString,
  admin: AdminSettings,
  prefsMap: Record<DutyMember, PreferenceMap>,
  yesterdayKind: Partial<Record<DutyMember, DutySlotKind>>,
  hol: Record<ISODateString, string>,
  state: DayAssignmentSearchState,
  rankTieRotationAttempt: number,
): DutyMember[] {
  const basePool = DUTY_MEMBERS.filter((m) => {
    if (isMemberExcludedGlobally(admin, m, date)) return false;
    if (state.assignedToday[m] !== undefined) return false;
    if (
      (slot.kind === "早番" || slot.kind === "遅番") &&
      isBlockedFromWeekdayEarlyLateDueToCongressNomination(admin, date, m, hol)
    ) {
      return false;
    }
    const flags = getFlags(prefsMap[m], date);
    if (violatesHardPreference(flags, slot.kind, date, hol)) return false;
    if (violatesInterval(slot.kind, yesterdayKind, m)) return false;
    if (violatesMorningHalfOnLateSlot(flags, slot.kind)) return false;
    return true;
  });

  let pool = basePool;
  if (pool.length === 0) {
    pool = DUTY_MEMBERS.filter((m) => {
      if (isMemberExcludedGlobally(admin, m, date)) return false;
      if (state.assignedToday[m] !== undefined) return false;
      if (
        (slot.kind === "早番" || slot.kind === "遅番") &&
        isBlockedFromWeekdayEarlyLateDueToCongressNomination(admin, date, m, hol)
      ) {
        return false;
      }
      const flags = getFlags(prefsMap[m], date);
      if (violatesHardPreference(flags, slot.kind, date, hol)) return false;
      if (violatesInterval(slot.kind, yesterdayKind, m)) return false;
      return true;
    });
  }

  if (pool.length === 0) return [];

  if (slot.kind === "早番" || slot.kind === "遅番") {
    if (slot.kind === "早番") {
      pool = preferAvoidEarlyAfterLateShift(pool, slot.kind, yesterdayKind);
      pool = preferAvoidEarlyAfterSunHolidayMain(pool, slot.kind, date, yesterdayKind, hol);
    }
    pool = preferAvoidConsecutiveEarlyShift(pool, slot.kind, yesterdayKind, undefined);
    pool = preferAvoidConsecutiveLateShift(pool, slot.kind, yesterdayKind, undefined);
    return sortedEarlyLateCandidatesByRankPriority(pool, rankTieRotationAttempt);
  }

  pool = preferNonNightForSundayHolidayReserve(pool, slot.kind, date, prefsMap, hol);
  pool = preferAvoidConsecutiveRestDayAttendance(pool, slot.kind, date, yesterdayKind, hol);

  if (slot.kind === "国会（応援）") {
    const sortedOuen = [...pool];
    sortedOuen.sort((a, b) =>
      compareWithTieBreak(
        (x, y) => compareForAssignment(x, y, state.auxiliaryDutyCounts),
        a,
        b,
        rankTieRotationAttempt,
      ),
    );
    return sortedOuen;
  }

  const sorted = [...pool];
  sorted.sort((a, b) =>
    compareWithTieBreak(
      (x, y) =>
        compareForMonthlyHolidayMainOrReserve(
          x,
          y,
          slot.kind,
          state.monthlyHolidayMainCounts,
          state.monthlyHolidayReserveCounts,
          state.auxiliaryDutyCounts,
        ),
      a,
      b,
      0,
    ),
  );
  return sorted;
}

/**
 * 同日の slots を深さ優先で探索し、欠員（未充足枠）数が最小の割当を返す。
 * 欠員本数が同じ解のうち、(1) 当日遅番の付け先の累計負荷和 (2) 期間内遅番の偏りスコア (3) 遅番の最大回数 (4) 早番偏りが小さいものを採用する。
 * 早番・遅番はハード＋回避系の後、`DUTY_MEMBER_RANK_PRIORITY_ORDER` 順で候補を試す。
 */
function runDaySlotsAssignmentSearch(
  slots: DemandSlot[],
  date: ISODateString,
  admin: AdminSettings,
  prefsMap: Record<DutyMember, PreferenceMap>,
  yesterdayKind: Partial<Record<DutyMember, DutySlotKind>>,
  hol: Record<ISODateString, string>,
  initial: DayAssignmentSearchState,
  rankTieRotationAttempt: number,
): { best: DayAssignmentSearchState; unfilled: UnfilledSlot[] } {
  type LeafRank = readonly [number, number, number, number, number];
  let searchNodes = 0;
  let best: DayAssignmentSearchState | null = null;
  let bestUnfilled: UnfilledSlot[] = [];
  let bestRank: LeafRank | null = null;

  /** `scoreRosterEarlyLateBalance` 内の spread と同形（部員集合固定） */
  function spreadRecordForMembers(counts: Record<DutyMember, number>): number {
    if (DUTY_MEMBERS.length < 2) return 0;
    let min = Infinity;
    let max = -Infinity;
    for (const m of DUTY_MEMBERS) {
      const c = counts[m] ?? 0;
      if (c < min) min = c;
      if (c > max) max = c;
    }
    const diff = max - min;
    return diff * diff * 10 + diff * 5;
  }

  function maxMemberCount(counts: Record<DutyMember, number>): number {
    let mx = 0;
    for (const m of DUTY_MEMBERS) {
      mx = Math.max(mx, counts[m] ?? 0);
    }
    return mx;
  }

  /** 当日に遅番が付いた人の、当該日終了時点の累計遅番回数の合計（小さいほど「すでに多い人に遅番を重ねにくい」） */
  function todayLateAssigneeCumulativeLateSum(state: DayAssignmentSearchState): number {
    let s = 0;
    const late = state.earlyLateDutyCounts.late;
    for (const m of DUTY_MEMBERS) {
      if (state.assignedToday[m] === "遅番") {
        s += late[m] ?? 0;
      }
    }
    return s;
  }

  function leafRank(failures: UnfilledSlot[], state: DayAssignmentSearchState): LeafRank {
    const late = state.earlyLateDutyCounts.late;
    const early = state.earlyLateDutyCounts.early;
    return [
      failures.length,
      todayLateAssigneeCumulativeLateSum(state),
      spreadRecordForMembers(late),
      maxMemberCount(late),
      spreadRecordForMembers(early),
    ];
  }

  function rankIsBetter(a: LeafRank, b: LeafRank): boolean {
    for (let i = 0; i < a.length; i++) {
      if (a[i] < b[i]) return true;
      if (a[i] > b[i]) return false;
    }
    return false;
  }

  function considerLeaf(failures: UnfilledSlot[], state: DayAssignmentSearchState): void {
    const r = leafRank(failures, state);
    if (best === null || bestRank === null || rankIsBetter(r, bestRank)) {
      bestRank = r;
      best = cloneDayAssignmentSearchState(state);
      bestUnfilled = [...failures];
    }
  }

  function dfs(slotIndex: number, state: DayAssignmentSearchState, failures: UnfilledSlot[]): void {
    if (searchNodes >= MAX_DAY_ASSIGNMENT_SEARCH_NODES) return;
    searchNodes += 1;

    if (slotIndex >= slots.length) {
      considerLeaf(failures, state);
      return;
    }

    const slot = slots[slotIndex]!;

    if (isDemandCongressSlotKind(slot.kind)) {
      const st = cloneDayAssignmentSearchState(state);
      const ok = tryAssignCongressWithOuenFallback(
        slot,
        date,
        admin,
        prefsMap,
        st.assignedToday,
        yesterdayKind,
        st.cells,
        st.auxiliaryDutyCounts,
        hol,
        undefined,
      );
      if (ok) {
        dfs(slotIndex + 1, st, failures);
      } else {
        failures.push({ date, slotId: slot.id, kind: slot.kind });
        dfs(slotIndex + 1, state, failures);
        failures.pop();
      }
      return;
    }

    if (slot.fixedAssignee !== undefined) {
      const st = cloneDayAssignmentSearchState(state);
      let placed = tryAssignFixedSlot(
        slot.fixedAssignee,
        slot,
        date,
        admin,
        prefsMap,
        st.assignedToday,
        yesterdayKind,
        st.cells,
        st.auxiliaryDutyCounts,
        false,
        hol,
      );
      if (!placed) {
        placed = tryAssignFixedSlot(
          slot.fixedAssignee,
          slot,
          date,
          admin,
          prefsMap,
          st.assignedToday,
          yesterdayKind,
          st.cells,
          st.auxiliaryDutyCounts,
          true,
          hol,
        );
      }
      if (!placed) {
        failures.push({ date, slotId: slot.id, kind: slot.kind });
        dfs(slotIndex + 1, state, failures);
        failures.pop();
      } else {
        dfs(slotIndex + 1, st, failures);
      }
      return;
    }

    const candidates = buildSortedCandidatePoolForVariableSlot(
      slot,
      date,
      admin,
      prefsMap,
      yesterdayKind,
      hol,
      state,
      rankTieRotationAttempt,
    );
    if (candidates.length === 0) {
      failures.push({ date, slotId: slot.id, kind: slot.kind });
      dfs(slotIndex + 1, state, failures);
      failures.pop();
      return;
    }

    for (const pick of candidates) {
      if (searchNodes >= MAX_DAY_ASSIGNMENT_SEARCH_NODES) return;
      const st = cloneDayAssignmentSearchState(state);
      applyVariableSlotToSearchState(st, slot, pick, admin, date, hol);
      dfs(slotIndex + 1, st, failures);
    }
  }

  dfs(0, initial, []);
  if (!best) {
    return { best: initial, unfilled: [] };
  }
  return { best, unfilled: bestUnfilled };
}

function generateRosterOnce(
  input: GenerateRosterInput,
  rankTieRotationAttempt: number,
): {
  days: GeneratedRosterDay[];
  unfilled: UnfilledSlot[];
} {
  const { admin, rangeStart, rangeEnd, preferencesByMember } = input;
  const hol = mergeHolidayMap(input.admin, input.holidaysExtra);

  const prefsMap: Record<DutyMember, PreferenceMap> = {} as Record<
    DutyMember,
    PreferenceMap
  >;
  for (const m of DUTY_MEMBERS) {
    prefsMap[m] = preferencesToMap(preferencesByMember[m]?.entries ?? []);
  }

  const earlyLateDutyCounts = createEarlyLateDutyCounts();
  const auxiliaryDutyCounts: Record<DutyMember, number> = {} as Record<
    DutyMember,
    number
  >;
  for (const m of DUTY_MEMBERS) {
    auxiliaryDutyCounts[m] = 0;
  }

  const monthlyHolidayMainCounts: Record<DutyMember, number> = {} as Record<
    DutyMember,
    number
  >;
  const monthlyHolidayReserveCounts: Record<DutyMember, number> = {} as Record<
    DutyMember,
    number
  >;
  let holidayBalanceYearMonth = "";

  let yesterdayKind: Partial<Record<DutyMember, DutySlotKind>> = {};
  const weeklyEarlyLate = createWeeklyEarlyLateCounts();
  const days: GeneratedRosterDay[] = [];
  const unfilled: UnfilledSlot[] = [];

  for (const date of eachDateInclusive(rangeStart, rangeEnd)) {
    resetWeeklyEarlyLateCountsIfNewWeek(weeklyEarlyLate, date);
    const ym = yearMonthFromIso(date);
    if (ym !== holidayBalanceYearMonth) {
      holidayBalanceYearMonth = ym;
      for (const m of DUTY_MEMBERS) {
        monthlyHolidayMainCounts[m] = 0;
        monthlyHolidayReserveCounts[m] = 0;
      }
    }
    const slots = appendSupplementalCongressOuenSlots(
      buildDemandSlotsForDate(admin, date, hol),
      admin,
      date,
      hol,
      prefsMap,
    );
    const dayInitial = createDaySearchStateFromGlobals(
      emptyCells(),
      auxiliaryDutyCounts,
      earlyLateDutyCounts,
      monthlyHolidayMainCounts,
      monthlyHolidayReserveCounts,
      weeklyEarlyLate,
    );
    const { best, unfilled: dayUnfilled } = runDaySlotsAssignmentSearch(
      slots,
      date,
      admin,
      prefsMap,
      yesterdayKind,
      hol,
      dayInitial,
      rankTieRotationAttempt,
    );
    commitDaySearchStateToGlobals(
      best,
      auxiliaryDutyCounts,
      earlyLateDutyCounts,
      monthlyHolidayMainCounts,
      monthlyHolidayReserveCounts,
      weeklyEarlyLate,
    );
    for (const u of dayUnfilled) {
      unfilled.push(u);
    }
    yesterdayKind = { ...best.assignedToday };
    const cells = best.cells;

    const holName = hol[date] ?? "";
    const finalized = finalizeRowCells(admin, date, cells, prefsMap, hol);
    const preferenceMarksByColumnPerson = {} as Record<RosterColumnPerson, string>;
    for (const p of ROSTER_COLUMN_ORDER) {
      if (p === "牛田" || p === "倉科") {
        preferenceMarksByColumnPerson[p] = "";
        continue;
      }
      preferenceMarksByColumnPerson[p] = formatPreferenceMarksForDay(
        getFlags(prefsMap[p as DutyMember], date),
      );
    }
    days.push({
      date,
      weekdayLabel: weekdayLabelJa(date),
      nationalHolidayColumnText: holName,
      eventsAndNotes: buildEventsColumnText(admin, date, hol),
      rosterCellsByColumnPerson: finalized,
      isRestDayPastelPinkRow:
        isSunday(date) || (!isSaturday(date) && Boolean(holidayNameOn(date, hol))),
      preferenceMarksByColumnPerson,
    });
  }

  return { days, unfilled };
}

/** 欠員数 → 月の早+遅合算の偏り → 週次・期間スコア → 試行番号（小さい＝本序列）の順で良し悪しを比較 */
function isStrictlyBetterRosterCandidateKey(
  candidate: readonly [number, number, number, number],
  current: readonly [number, number, number, number],
): boolean {
  for (let i = 0; i < 4; i++) {
    if (candidate[i] < current[i]) return true;
    if (candidate[i] > current[i]) return false;
  }
  return false;
}

/** 同数均等化を優先し、改善が止まるまで試行して最も偏りの少ない案を採用する */
export function generateRoster(input: GenerateRosterInput): {
  days: GeneratedRosterDay[];
  unfilled: UnfilledSlot[];
} {
  const hol = mergeHolidayMap(input.admin, input.holidaysExtra);
  let best: { days: GeneratedRosterDay[]; unfilled: UnfilledSlot[] } | null =
    null;
  let bestKey: [number, number, number, number] | null = null;
  let staleAttempts = 0;

  for (let attempt = 0; attempt < ROSTER_GENERATION_MAX_ATTEMPTS; attempt++) {
    const result = generateRosterOnce(input, attempt);
    const unf = result.unfilled.length;
    const monthlySpread = scoreMonthlyEarlyLateCombinedSpread(result.days);
    const weeklyScore = scoreRosterEarlyLateBalance(
      result.days,
      input.rangeStart,
      input.rangeEnd,
      input.admin,
      hol,
      result.unfilled,
    );
    const key: [number, number, number, number] = [
      unf,
      monthlySpread,
      weeklyScore,
      attempt,
    ];
    if (bestKey === null || isStrictlyBetterRosterCandidateKey(key, bestKey)) {
      best = result;
      bestKey = key;
      staleAttempts = 0;
    } else {
      staleAttempts += 1;
      if (staleAttempts >= ROSTER_RETRY_STALE_ATTEMPTS) break;
    }
  }

  return best!;
}

function finalizeRowCells(
  admin: AdminSettings,
  date: ISODateString,
  draft: Record<RosterColumnPerson, string>,
  prefsMap: Record<DutyMember, PreferenceMap>,
  hol: Record<ISODateString, string>,
): Record<RosterColumnPerson, string> {
  let out = { ...draft };
  for (const p of ROSTER_COLUMN_ORDER) {
    if (p === "牛田" || p === "倉科") {
      out[p] = "";
      continue;
    }
    const duty = p as DutyMember;
    if (admin.secondmentByDutyMember[duty] === "on_loan") {
      out[p] = "";
      continue;
    }
  }
  out = applyCongressNominationCellLabels(out, admin, date, prefsMap, hol);
  out = applyGraphExclusiveIsobeCellLabel(out, admin, date, prefsMap);
  out = applyNewspaperWorkdayAssigneeCell(out, admin, date);
  return out;
}
