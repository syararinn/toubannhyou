import type {
  AdminSettings,
  DutyMember,
  GeneratedRosterDay,
  ISODateString,
  MemberPreferenceInput,
  RosterColumnPerson,
} from "@/types";
import { DUTY_MEMBER_RANK_ORDER_BY_MEMBER, ROSTER_COLUMN_ORDER } from "@/types";
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
import { holidayNameOn, JP_HOLIDAYS_2026 } from "./holidays";
import { applyCongressNominationCellLabels } from "./congress-nomination-display";
import { applyGraphExclusiveIsobeCellLabel } from "./graph-exclusive-display";
import { formatPreferenceMarksForDay } from "./preference-marks";
import {
  buildDemandSlotsForDate,
  buildEventsColumnText,
  type DemandSlot,
  type DutySlotKind,
  lookupCongressMonthly,
  lookupCongressWeekly,
} from "./slots";
import {
  createEarlyLateDutyCounts,
  recordEarlyLateDutyAssignment,
} from "./early-late-duty-counts";
import { compareForEarlyLateSlotAssignment } from "./early-late-assignment-compare";
import { augmentPoolForEqualizationAssignment } from "./equalization-candidate-prefs";
import {
  scoreRosterEarlyLateBalance,
  tieBreakOrderForAttempt,
} from "./roster-balance-score";
import {
  createWeeklyEarlyLateCounts,
  isExcludedFromWeeklyEarlyLateBalance,
  preferMinimumPeriodEarlyLateInPool,
  preferMinimumWeeklyEarlyLateInPool,
  recordWeeklyEarlyLateAssignment,
  resetWeeklyEarlyLateCountsIfNewWeek,
  weeklyMinimumKindMembersInPool,
} from "./weekly-early-late-balance";

const DUTY_MEMBERS: DutyMember[] = (
  Object.keys(DUTY_MEMBER_RANK_ORDER_BY_MEMBER) as DutyMember[]
).sort(
  (a, b) => DUTY_MEMBER_RANK_ORDER_BY_MEMBER[a] - DUTY_MEMBER_RANK_ORDER_BY_MEMBER[b],
);

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
  extra?: Record<ISODateString, string>,
): Record<ISODateString, string> {
  return { ...JP_HOLIDAYS_2026, ...extra };
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

/** 管理者が指名した国会月番・国会週番は、その月／その週ブロックの平日は早番・遅番に入れない（会期外の平日も週番・月番の指名は有効） */
function isBlockedFromWeekdayEarlyLateDueToCongressNomination(
  admin: AdminSettings,
  date: ISODateString,
  member: DutyMember,
  hol: Record<ISODateString, string>,
): boolean {
  if (!isWeekdayMonFri(date)) return false;
  if (holidayNameOn(date, hol)) return false;
  if (lookupCongressMonthly(admin, date) === member) return true;
  if (lookupCongressWeekly(admin, date) === member) return true;
  return false;
}

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
  unfilled: UnfilledSlot[],
): void {
  const fix = slot.fixedAssignee;
  if (fix === undefined) {
    unfilled.push({ date, slotId: slot.id, kind: slot.kind });
    return;
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

  if (placed) return;

  const ouenSlot: DemandSlot = { id: `${slot.id}-ouen`, kind: CONGRESS_OUEN_KIND };
  let pool = buildCongressOuenPool(date, admin, prefsMap, assignedToday, yesterdayKind, hol, false);
  if (pool.length === 0) {
    pool = buildCongressOuenPool(date, admin, prefsMap, assignedToday, yesterdayKind, hol, true);
  }
  if (pool.length === 0) {
    unfilled.push({ date, slotId: slot.id, kind: slot.kind });
    return;
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
      return;
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
      return;
    }
  }
  unfilled.push({ date, slotId: slot.id, kind: slot.kind });
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

/** リトライ上限（打切りによりこれ未満で終了することが多い） */
const ROSTER_GENERATION_MAX_ATTEMPTS = 30;
/** この回数連続で偏りスコアが改善しなければ打切り */
const ROSTER_RETRY_STALE_ATTEMPTS = 5;

function compareWithTieBreak(
  baseCompare: (a: DutyMember, b: DutyMember) => number,
  a: DutyMember,
  b: DutyMember,
  tieBreakOrder: DutyMember[],
): number {
  const c = baseCompare(a, b);
  if (c !== 0) return c;
  const ia = tieBreakOrder.indexOf(a);
  const ib = tieBreakOrder.indexOf(b);
  return ia - ib;
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

function generateRosterOnce(
  input: GenerateRosterInput,
  tieBreakOrder: DutyMember[],
): {
  days: GeneratedRosterDay[];
  unfilled: UnfilledSlot[];
} {
  const { admin, rangeStart, rangeEnd, preferencesByMember } = input;
  const hol = mergeHolidayMap(input.holidaysExtra);

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

  let yesterdayKind: Partial<Record<DutyMember, DutySlotKind>> = {};
  const weeklyEarlyLate = createWeeklyEarlyLateCounts();
  const days: GeneratedRosterDay[] = [];
  const unfilled: UnfilledSlot[] = [];

  for (const date of eachDateInclusive(rangeStart, rangeEnd)) {
    resetWeeklyEarlyLateCountsIfNewWeek(weeklyEarlyLate, date);
    const slots = buildDemandSlotsForDate(admin, date, hol);
    const assignedToday: Partial<Record<DutyMember, DutySlotKind>> = {};
    const cells = emptyCells();

    for (const slot of slots) {
      if (isDemandCongressSlotKind(slot.kind)) {
        tryAssignCongressWithOuenFallback(
          slot,
          date,
          admin,
          prefsMap,
          assignedToday,
          yesterdayKind,
          cells,
          auxiliaryDutyCounts,
          hol,
          unfilled,
        );
        continue;
      }

      if (slot.fixedAssignee !== undefined) {
        let placed = tryAssignFixedSlot(
          slot.fixedAssignee,
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
        );
        if (!placed) {
          placed = tryAssignFixedSlot(
            slot.fixedAssignee,
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
        if (!placed) {
          unfilled.push({ date, slotId: slot.id, kind: slot.kind });
        }
        continue;
      }

      const basePool = DUTY_MEMBERS.filter((m) => {
        if (isMemberExcludedGlobally(admin, m, date)) return false;
        if (assignedToday[m] !== undefined) return false;
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
          if (assignedToday[m] !== undefined) return false;
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

      if (pool.length === 0) {
        unfilled.push({ date, slotId: slot.id, kind: slot.kind });
        continue;
      }

      const isCongressNomineeBlocked = (m: DutyMember) =>
        (slot.kind === "早番" || slot.kind === "遅番") &&
        isBlockedFromWeekdayEarlyLateDueToCongressNomination(admin, date, m, hol);

      let weeklyMinGuard: Set<DutyMember> | undefined;
      if (slot.kind === "早番" || slot.kind === "遅番") {
        if (slot.kind === "早番") {
          pool = preferAvoidEarlyAfterLateShift(pool, slot.kind, yesterdayKind);
          pool = preferAvoidEarlyAfterSunHolidayMain(
            pool,
            slot.kind,
            date,
            yesterdayKind,
            hol,
          );
        }
        pool = augmentPoolForEqualizationAssignment(
          pool,
          slot.kind,
          date,
          admin,
          prefsMap,
          assignedToday,
          yesterdayKind,
          hol,
          isCongressNomineeBlocked,
        );
        weeklyMinGuard = weeklyMinimumKindMembersInPool(
          pool,
          slot.kind,
          weeklyEarlyLate.early,
          weeklyEarlyLate.late,
          admin,
          date,
          hol,
        );
        pool = preferMinimumWeeklyEarlyLateInPool(
          pool,
          slot.kind,
          weeklyEarlyLate.early,
          weeklyEarlyLate.late,
          admin,
          date,
          hol,
        );
        pool = preferMinimumPeriodEarlyLateInPool(
          pool,
          slot.kind,
          earlyLateDutyCounts.early,
          earlyLateDutyCounts.late,
        );
        pool = preferAvoidConsecutiveEarlyShift(
          pool,
          slot.kind,
          yesterdayKind,
          weeklyMinGuard,
        );
        pool = preferAvoidConsecutiveLateShift(
          pool,
          slot.kind,
          yesterdayKind,
          weeklyMinGuard,
        );
      } else {
        pool = preferNonNightForSundayHolidayReserve(pool, slot.kind, date, prefsMap, hol);
        pool = preferAvoidConsecutiveRestDayAttendance(
          pool,
          slot.kind,
          date,
          yesterdayKind,
          hol,
        );
      }
      if (slot.kind === "早番") {
        pool.sort((a, b) =>
          compareWithTieBreak(
            (x, y) =>
              compareForEarlyLateSlotAssignment(
                x,
                y,
                "早番",
                weeklyEarlyLate.early,
                weeklyEarlyLate.late,
                earlyLateDutyCounts.early,
                date,
                prefsMap,
                yesterdayKind,
                hol,
              ),
            a,
            b,
            tieBreakOrder,
          ),
        );
      } else if (slot.kind === "遅番") {
        pool.sort((a, b) =>
          compareWithTieBreak(
            (x, y) =>
              compareForEarlyLateSlotAssignment(
                x,
                y,
                "遅番",
                weeklyEarlyLate.early,
                weeklyEarlyLate.late,
                earlyLateDutyCounts.late,
                date,
                prefsMap,
                yesterdayKind,
                hol,
              ),
            a,
            b,
            tieBreakOrder,
          ),
        );
      } else {
        pool.sort((a, b) =>
          compareWithTieBreak(
            (x, y) => compareForAssignment(x, y, auxiliaryDutyCounts),
            a,
            b,
            tieBreakOrder,
          ),
        );
      }
      const pick = pool[0]!;
      assignedToday[pick] = slot.kind;
      if (slot.kind === "早番" || slot.kind === "遅番") {
        recordEarlyLateDutyAssignment(earlyLateDutyCounts, pick, slot.kind);
      } else {
        auxiliaryDutyCounts[pick] = (auxiliaryDutyCounts[pick] ?? 0) + 1;
      }
      if (
        (slot.kind === "早番" || slot.kind === "遅番") &&
        !isExcludedFromWeeklyEarlyLateBalance(admin, date, pick, hol)
      ) {
        recordWeeklyEarlyLateAssignment(weeklyEarlyLate, pick, slot.kind);
      }
      const prev = cells[pick] ?? "";
      cells[pick] = mergeDutyLabel(prev, slot.kind);
    }

    yesterdayKind = { ...assignedToday };

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

/** 同数均等化を優先し、改善が止まるまで試行して最も偏りの少ない案を採用する */
export function generateRoster(input: GenerateRosterInput): {
  days: GeneratedRosterDay[];
  unfilled: UnfilledSlot[];
} {
  const hol = mergeHolidayMap(input.holidaysExtra);
  let best: { days: GeneratedRosterDay[]; unfilled: UnfilledSlot[] } | null =
    null;
  let bestScore = Infinity;
  let staleAttempts = 0;

  for (let attempt = 0; attempt < ROSTER_GENERATION_MAX_ATTEMPTS; attempt++) {
    const tieBreakOrder = tieBreakOrderForAttempt(attempt);
    const result = generateRosterOnce(input, tieBreakOrder);
    const score = scoreRosterEarlyLateBalance(
      result.days,
      input.rangeStart,
      input.rangeEnd,
      input.admin,
      hol,
      result.unfilled,
    );
    const better =
      score < bestScore ||
      (score === bestScore &&
        best !== null &&
        result.unfilled.length < best.unfilled.length);
    if (best === null || better) {
      best = result;
      bestScore = score;
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
  return out;
}
