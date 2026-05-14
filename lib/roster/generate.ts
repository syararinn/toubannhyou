import type {
  AdminSettings,
  DutyMember,
  GeneratedRosterDay,
  ISODateString,
  MemberPreferenceInput,
  RosterColumnPerson,
} from "@/types";
import { DUTY_MEMBER_RANK_ORDER_BY_MEMBER, ROSTER_COLUMN_ORDER } from "@/types";
import { eachDateInclusive, weekdayLabelJa } from "./dates";
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
import { JP_HOLIDAYS_2026 } from "./holidays";
import {
  buildDemandSlotsForDate,
  buildEventsColumnText,
  type DemandSlot,
  type DutySlotKind,
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
): boolean {
  if (isMemberExcludedGlobally(admin, pick, date)) return false;
  if (assignedToday[pick] !== undefined) return false;
  const flags = getFlags(prefsMap[pick], date);
  if (violatesHardPreference(flags, slot.kind)) return false;
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

function isCongressSlotKind(kind: DutySlotKind): boolean {
  return kind === "国会月番" || kind === "国会週番" || kind === "国会";
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
      if (slot.fixedAssignee !== undefined || isCongressSlotKind(slot.kind)) {
        if (slot.fixedAssignee === undefined) {
          unfilled.push({ date, slotId: slot.id, kind: slot.kind });
          continue;
        }
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
        const flags = getFlags(prefsMap[m], date);
        if (violatesHardPreference(flags, slot.kind)) return false;
        if (violatesInterval(slot.kind, yesterdayKind, m)) return false;
        if (violatesMorningHalfOnLateSlot(flags, slot.kind)) return false;
        return true;
      });

      let pool = basePool;
      if (pool.length === 0) {
        pool = DUTY_MEMBERS.filter((m) => {
          if (isMemberExcludedGlobally(admin, m, date)) return false;
          if (assignedToday[m] !== undefined) return false;
          const flags = getFlags(prefsMap[m], date);
          if (violatesHardPreference(flags, slot.kind)) return false;
          if (violatesInterval(slot.kind, yesterdayKind, m)) return false;
          return true;
        });
      }

      if (pool.length === 0) {
        unfilled.push({ date, slotId: slot.id, kind: slot.kind });
        continue;
      }

      pool.sort((a, b) => compareForAssignment(a, b, dutyCounts));
      const pick = pool[0]!;
      assignedToday[pick] = slot.kind;
      dutyCounts[pick] += 1;
      const prev = cells[pick] ?? "";
      cells[pick] = mergeDutyLabel(prev, slot.kind);
    }

    yesterdayKind = { ...assignedToday };

    const holName = hol[date] ?? "";
    days.push({
      date,
      weekdayLabel: weekdayLabelJa(date),
      nationalHolidayColumnText: holName,
      eventsAndNotes: buildEventsColumnText(admin, date, hol),
      rosterCellsByColumnPerson: finalizeRowCells(admin, date, cells),
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
