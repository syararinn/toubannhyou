import type {
  AdminSettings,
  DutyMember,
  ISODateString,
  MemberDayPreferenceFlags,
} from "@/types";
import { ROSTER_COLUMN_ORDER } from "@/types";
import type { PreferenceToggleKey } from "@/lib/preferenceLimits";
import { appendSupplementalCongressOuenSlots } from "./congress-supplement-slots";
import {
  emptyPreferenceFlags,
  getFlags,
  isMemberExcludedGlobally,
  preferencesToMap,
  violatesHardPreference,
  violatesInterval,
  violatesMorningHalfOnLateSlot,
  type PreferenceMap,
} from "./eligibility";
import { isWeekdayMonFri } from "./dates";
import { holidayNameOn } from "./holidays";
import {
  buildDemandSlotsForDate,
  isBlockedFromWeekdayEarlyLateDueToCongressNomination,
  lookupCongressMonthly,
  lookupCongressWeekly,
  type DemandSlot,
  type DutySlotKind,
} from "./slots";

const DUTY_MEMBERS = ROSTER_COLUMN_ORDER.filter(
  (x): x is DutyMember => x !== "牛田" && x !== "倉科",
);

const CONGRESS_OUEN_KIND: DutySlotKind = "国会（応援）";

const EMPTY_YESTERDAY: Partial<Record<DutyMember, DutySlotKind>> = {};

export const DAILY_DEMAND_FEASIBILITY_BLOCK_MESSAGE =
  "この日は当番調整の限界値に達しています。もしもこの日にチェックを入れる場合は部員間で調整をお願いします";

/** 平日早遅の「立てる人」がちょうど2人だけのとき（需要はまだ成立しているが余裕がない） */
export const PERSONNEL_TIGHT_MESSAGE =
  "人の余裕が少なくなっています。協力をお願いします";

function storeToPrefsMap(
  store: Record<DutyMember, Record<ISODateString, MemberDayPreferenceFlags>>,
): Record<DutyMember, PreferenceMap> {
  const out = {} as Record<DutyMember, PreferenceMap>;
  for (const m of DUTY_MEMBERS) {
    const rec = store[m] ?? {};
    const entries = Object.entries(rec).map(([d, f]) => ({
      date: d as ISODateString,
      flags: f,
    }));
    out[m] = preferencesToMap(entries);
  }
  return out;
}

function cloneStore(
  store: Record<DutyMember, Record<ISODateString, MemberDayPreferenceFlags>>,
): Record<DutyMember, Record<ISODateString, MemberDayPreferenceFlags>> {
  const out: Record<DutyMember, Record<ISODateString, MemberDayPreferenceFlags>> = {} as Record<
    DutyMember,
    Record<ISODateString, MemberDayPreferenceFlags>
  >;
  for (const m of DUTY_MEMBERS) {
    out[m] = { ...(store[m] ?? {}) };
  }
  return out;
}

function canMemberTakeSlotHard(
  admin: AdminSettings,
  date: ISODateString,
  hol: Record<ISODateString, string>,
  prefsMap: Record<DutyMember, PreferenceMap>,
  assigned: Partial<Record<DutyMember, DutySlotKind>>,
  member: DutyMember,
  kind: DutySlotKind,
  allowSoftMorningOnLate: boolean,
): boolean {
  if (isMemberExcludedGlobally(admin, member, date)) return false;
  if (assigned[member] !== undefined) return false;
  if (
    (kind === "早番" || kind === "遅番") &&
    isBlockedFromWeekdayEarlyLateDueToCongressNomination(admin, date, member, hol)
  ) {
    return false;
  }
  const flags = getFlags(prefsMap[member], date);
  if (violatesHardPreference(flags, kind, date, hol)) return false;
  if (violatesInterval(kind, EMPTY_YESTERDAY, member)) return false;
  if (!allowSoftMorningOnLate && violatesMorningHalfOnLateSlot(flags, kind)) {
    return false;
  }
  return true;
}

function congressSupportPool(
  date: ISODateString,
  admin: AdminSettings,
  prefsMap: Record<DutyMember, PreferenceMap>,
  assigned: Partial<Record<DutyMember, DutySlotKind>>,
  hol: Record<ISODateString, string>,
  allowSoftMorningOnLate: boolean,
): DutyMember[] {
  return DUTY_MEMBERS.filter((m) => {
    if (isMemberExcludedGlobally(admin, m, date)) return false;
    if (lookupCongressMonthly(admin, date) === m) return false;
    if (lookupCongressWeekly(admin, date) === m) return false;
    const k = assigned[m];
    if (k === "早番" || k === "遅番") return false;
    if (k !== undefined) return false;
    const flags = getFlags(prefsMap[m], date);
    if (violatesHardPreference(flags, CONGRESS_OUEN_KIND, date, hol)) return false;
    if (violatesInterval(CONGRESS_OUEN_KIND, EMPTY_YESTERDAY, m)) return false;
    if (!allowSoftMorningOnLate && violatesMorningHalfOnLateSlot(flags, CONGRESS_OUEN_KIND)) {
      return false;
    }
    return true;
  });
}

function isCongressDemandKind(kind: DutySlotKind): boolean {
  return kind === "国会月番" || kind === "国会週番" || kind === "国会";
}

function dfsAssignSlots(
  slots: DemandSlot[],
  slotIndex: number,
  admin: AdminSettings,
  date: ISODateString,
  hol: Record<ISODateString, string>,
  prefsMap: Record<DutyMember, PreferenceMap>,
  assigned: Partial<Record<DutyMember, DutySlotKind>>,
  allowSoftMorningOnLate: boolean,
): boolean {
  if (slotIndex >= slots.length) return true;
  const slot = slots[slotIndex]!;

  if (isCongressDemandKind(slot.kind)) {
    const fix = slot.fixedAssignee;
    if (fix !== undefined) {
      const flags = getFlags(prefsMap[fix], date);
      const hardOut = flags.fullDayOff || flags.fullyUnavailable;

      if (!hardOut) {
        if (
          canMemberTakeSlotHard(
            admin,
            date,
            hol,
            prefsMap,
            assigned,
            fix,
            slot.kind,
            allowSoftMorningOnLate,
          )
        ) {
          assigned[fix] = slot.kind;
          if (
            dfsAssignSlots(
              slots,
              slotIndex + 1,
              admin,
              date,
              hol,
              prefsMap,
              assigned,
              allowSoftMorningOnLate,
            )
          ) {
            return true;
          }
          delete assigned[fix];
        }
        if (
          !allowSoftMorningOnLate &&
          canMemberTakeSlotHard(admin, date, hol, prefsMap, assigned, fix, slot.kind, true)
        ) {
          assigned[fix] = slot.kind;
          if (
            dfsAssignSlots(
              slots,
              slotIndex + 1,
              admin,
              date,
              hol,
              prefsMap,
              assigned,
              allowSoftMorningOnLate,
            )
          ) {
            return true;
          }
          delete assigned[fix];
        }
      }

      let pool = congressSupportPool(date, admin, prefsMap, assigned, hol, false);
      if (pool.length === 0) {
        pool = congressSupportPool(date, admin, prefsMap, assigned, hol, true);
      }
      for (const m of pool) {
        if (!canMemberTakeSlotHard(admin, date, hol, prefsMap, assigned, m, CONGRESS_OUEN_KIND, true)) {
          continue;
        }
        assigned[m] = CONGRESS_OUEN_KIND;
        if (
          dfsAssignSlots(
            slots,
            slotIndex + 1,
            admin,
            date,
            hol,
            prefsMap,
            assigned,
            allowSoftMorningOnLate,
          )
        ) {
          return true;
        }
        delete assigned[m];
      }
      return false;
    }

    let poolU = congressSupportPool(date, admin, prefsMap, assigned, hol, false);
    if (poolU.length === 0) {
      poolU = congressSupportPool(date, admin, prefsMap, assigned, hol, true);
    }
    for (const m of poolU) {
      if (!canMemberTakeSlotHard(admin, date, hol, prefsMap, assigned, m, slot.kind, true)) {
        continue;
      }
      assigned[m] = slot.kind;
      if (
        dfsAssignSlots(
          slots,
          slotIndex + 1,
          admin,
          date,
          hol,
          prefsMap,
          assigned,
          allowSoftMorningOnLate,
        )
      ) {
        return true;
      }
      delete assigned[m];
    }
    return false;
  }

  const kind = slot.kind;
  for (const m of DUTY_MEMBERS) {
    if (!canMemberTakeSlotHard(admin, date, hol, prefsMap, assigned, m, kind, allowSoftMorningOnLate)) {
      continue;
    }
    assigned[m] = kind;
    if (
      dfsAssignSlots(
        slots,
        slotIndex + 1,
        admin,
        date,
        hol,
        prefsMap,
        assigned,
        allowSoftMorningOnLate,
      )
    ) {
      return true;
    }
    delete assigned[m];
  }
  return false;
}

/**
 * その日の需要枠（早番・遅番・国会・応援・土日祝のメイン／予備）を、
 * 希望のハード制約のもとで全員別々に満たせるか（前日インターバルは考慮しない）。
 */
export function dailyDemandFeasible(
  admin: AdminSettings,
  date: ISODateString,
  hol: Record<ISODateString, string>,
  prefsMap: Record<DutyMember, PreferenceMap>,
): boolean {
  const base = buildDemandSlotsForDate(admin, date, hol);
  const slots = appendSupplementalCongressOuenSlots(base, admin, date, hol, prefsMap);
  if (slots.length === 0) return true;

  const assigned: Partial<Record<DutyMember, DutySlotKind>> = {};
  if (dfsAssignSlots(slots, 0, admin, date, hol, prefsMap, assigned, false)) {
    return true;
  }
  return dfsAssignSlots(slots, 0, admin, date, hol, prefsMap, {}, true);
}

export function preferenceOnWouldBreakDailyDemand(
  admin: AdminSettings,
  hol: Record<ISODateString, string>,
  store: Record<DutyMember, Record<ISODateString, MemberDayPreferenceFlags>>,
  editingMember: DutyMember,
  date: ISODateString,
  _key: PreferenceToggleKey,
  nextFlagsForThatDay: MemberDayPreferenceFlags,
): string | null {
  const hypo = cloneStore(store);
  const cur = hypo[editingMember][date] ?? emptyPreferenceFlags();
  const merged = { ...cur, ...nextFlagsForThatDay };
  if (
    !merged.fullDayOff &&
    !merged.fullyUnavailable &&
    !merged.morningHalfOff &&
    !merged.afternoonHalfOff &&
    !merged.nightUnavailable
  ) {
    const { [date]: _, ...rest } = hypo[editingMember];
    hypo[editingMember] = rest;
  } else {
    hypo[editingMember] = { ...hypo[editingMember], [date]: merged };
  }
  const prefsMap = storeToPrefsMap(hypo);
  if (dailyDemandFeasible(admin, date, hol, prefsMap)) return null;
  return DAILY_DEMAND_FEASIBILITY_BLOCK_MESSAGE;
}

export function dailyDemandFeasibleFromStore(
  admin: AdminSettings,
  date: ISODateString,
  hol: Record<ISODateString, string>,
  store: Record<DutyMember, Record<ISODateString, MemberDayPreferenceFlags>>,
): boolean {
  return dailyDemandFeasible(admin, date, hol, storeToPrefsMap(store));
}

/**
 * 平日（祝除く）で早番または遅番に立てる部員の人数（同一人物は1回）。
 * 早遅需要がない日は -1。
 */
export function weekdayEarlyOrLateUnionCount(
  admin: AdminSettings,
  date: ISODateString,
  hol: Record<ISODateString, string>,
  prefsMap: Record<DutyMember, PreferenceMap>,
): number {
  if (!isWeekdayMonFri(date) || holidayNameOn(date, hol)) return -1;
  const base = buildDemandSlotsForDate(admin, date, hol);
  const slots = appendSupplementalCongressOuenSlots(base, admin, date, hol, prefsMap);
  if (!slots.some((s) => s.kind === "早番" || s.kind === "遅番")) return -1;
  const assigned: Partial<Record<DutyMember, DutySlotKind>> = {};
  let n = 0;
  for (const m of DUTY_MEMBERS) {
    const early = canMemberTakeSlotHard(admin, date, hol, prefsMap, assigned, m, "早番", true);
    const late = canMemberTakeSlotHard(admin, date, hol, prefsMap, assigned, m, "遅番", true);
    if (early || late) n += 1;
  }
  return n;
}

/** 需要は成立しているが、早遅に回せる人がちょうど2人だけの日 */
export function isWeekdayPersonnelTightButFeasibleFromStore(
  admin: AdminSettings,
  date: ISODateString,
  hol: Record<ISODateString, string>,
  store: Record<DutyMember, Record<ISODateString, MemberDayPreferenceFlags>>,
): boolean {
  if (!dailyDemandFeasibleFromStore(admin, date, hol, store)) return false;
  const prefsMap = storeToPrefsMap(store);
  return weekdayEarlyOrLateUnionCount(admin, date, hol, prefsMap) === 2;
}
