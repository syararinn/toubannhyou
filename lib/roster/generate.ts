import type {
  AdminSettings,
  DutyMember,
  GeneratedRosterDay,
  ISODateString,
  MemberPreferenceInput,
  RosterColumnPerson,
} from "@/types";
import { DUTY_MEMBER_RANK_ORDER_BY_MEMBER, ROSTER_COLUMN_ORDER } from "@/types";
import { eachDateInclusive, isSaturday, isSunday, isWeekdayMonFri, weekdayLabelJa } from "./dates";
import {
  compareForAssignment,
  getFlags,
  isMemberExcludedGlobally,
  preferencesToMap,
  type PreferenceMap,
  violatesHardPreference,
  violatesInterval,
  violatesMorningHalfOnLateSlot,
} from "./eligibility";
import { holidayNameOn, JP_HOLIDAYS_2026 } from "./holidays";
import { formatPreferenceMarksForDay } from "./preference-marks";
import {
  buildDemandSlotsForDate,
  buildEventsColumnText,
  type DemandSlot,
  type DutySlotKind,
  lookupCongressMonthly,
  lookupCongressWeekly,
} from "./slots";

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
  dutyCounts: Record<DutyMember, number>,
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
  dutyCounts[pick] += 1;
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
  dutyCounts: Record<DutyMember, number>,
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
        dutyCounts,
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
        dutyCounts,
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
  pool.sort((a, b) => compareForAssignment(a, b, dutyCounts));
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
        dutyCounts,
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
        dutyCounts,
        true,
        hol,
      )
    ) {
      return;
    }
  }
  unfilled.push({ date, slotId: slot.id, kind: slot.kind });
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

export function generateRoster(input: GenerateRosterInput): {
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

  const dutyCounts: Record<DutyMember, number> = {} as Record<DutyMember, number>;
  for (const m of DUTY_MEMBERS) {
    dutyCounts[m] = 0;
  }

  let yesterdayKind: Partial<Record<DutyMember, DutySlotKind>> = {};
  const days: GeneratedRosterDay[] = [];
  const unfilled: UnfilledSlot[] = [];

  for (const date of eachDateInclusive(rangeStart, rangeEnd)) {
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
          dutyCounts,
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
          dutyCounts,
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
            dutyCounts,
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

      pool = preferNonNightForSundayHolidayReserve(pool, slot.kind, date, prefsMap, hol);
      pool.sort((a, b) => compareForAssignment(a, b, dutyCounts));
      const pick = pool[0]!;
      assignedToday[pick] = slot.kind;
      dutyCounts[pick] += 1;
      const prev = cells[pick] ?? "";
      cells[pick] = mergeDutyLabel(prev, slot.kind);
    }

    yesterdayKind = { ...assignedToday };

    const holName = hol[date] ?? "";
    const finalized = finalizeRowCells(admin, date, cells);
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

function finalizeRowCells(
  admin: AdminSettings,
  date: ISODateString,
  draft: Record<RosterColumnPerson, string>,
): Record<RosterColumnPerson, string> {
  const out = { ...draft };
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
  return out;
}
