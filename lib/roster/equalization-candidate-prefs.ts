import type { AdminSettings, DutyMember, ISODateString } from "@/types";
import { DUTY_MEMBER_RANK_ORDER_BY_MEMBER } from "@/types";
import { addDays, isSunday } from "./dates";
import {
  getFlags,
  hadCongressDutyYesterday,
  isMemberExcludedGlobally,
  type PreferenceMap,
  violatesHardPreference,
  type YesterdaySlotMap,
} from "./eligibility";
import { holidayNameOn } from "./holidays";
import type { DutySlotKind } from "./slots";

const DUTY_MEMBERS: DutyMember[] = (
  Object.keys(DUTY_MEMBER_RANK_ORDER_BY_MEMBER) as DutyMember[]
).sort(
  (a, b) => DUTY_MEMBER_RANK_ORDER_BY_MEMBER[a] - DUTY_MEMBER_RANK_ORDER_BY_MEMBER[b],
);

function hadSunOrHolidayCalendarYesterday(
  date: ISODateString,
  hol: Record<ISODateString, string>,
): boolean {
  const yesterday = addDays(date, -1);
  return isSunday(yesterday) || Boolean(holidayNameOn(yesterday, hol));
}

function memberEligibleForLateSlot(
  m: DutyMember,
  date: ISODateString,
  admin: AdminSettings,
  prefsMap: Record<DutyMember, PreferenceMap>,
  assignedToday: Partial<Record<DutyMember, DutySlotKind>>,
  hol: Record<ISODateString, string>,
  isCongressNomineeBlocked: (m: DutyMember) => boolean,
  allowMorningHalfSoft: boolean,
): boolean {
  if (isMemberExcludedGlobally(admin, m, date)) return false;
  if (assignedToday[m] !== undefined) return false;
  if (isCongressNomineeBlocked(m)) return false;
  const flags = getFlags(prefsMap[m], date);
  if (violatesHardPreference(flags, "遅番", date, hol)) return false;
  if (!allowMorningHalfSoft && flags.morningHalfOff) return false;
  return true;
}

function memberEligibleForEarlySlot(
  m: DutyMember,
  date: ISODateString,
  admin: AdminSettings,
  prefsMap: Record<DutyMember, PreferenceMap>,
  assignedToday: Partial<Record<DutyMember, DutySlotKind>>,
  hol: Record<ISODateString, string>,
  isCongressNomineeBlocked: (m: DutyMember) => boolean,
): boolean {
  if (isMemberExcludedGlobally(admin, m, date)) return false;
  if (assignedToday[m] !== undefined) return false;
  if (isCongressNomineeBlocked(m)) return false;
  const flags = getFlags(prefsMap[m], date);
  if (violatesHardPreference(flags, "早番", date, hol)) return false;
  return true;
}

/** 同数化のため遅番候補を広げる（午前半休・国会翌日・日祝翌日） */
export function augmentPoolForLateEqualization(
  pool: DutyMember[],
  date: ISODateString,
  admin: AdminSettings,
  prefsMap: Record<DutyMember, PreferenceMap>,
  assignedToday: Partial<Record<DutyMember, DutySlotKind>>,
  yesterdayKind: YesterdaySlotMap,
  hol: Record<ISODateString, string>,
  isCongressNomineeBlocked: (m: DutyMember) => boolean,
): DutyMember[] {
  const inPool = new Set(pool);
  const extras: DutyMember[] = [];
  const sunHolYesterday = hadSunOrHolidayCalendarYesterday(date, hol);

  for (const m of DUTY_MEMBERS) {
    if (inPool.has(m)) continue;
    const flags = getFlags(prefsMap[m], date);
    const boost =
      flags.morningHalfOff ||
      hadCongressDutyYesterday(yesterdayKind, m) ||
      sunHolYesterday;
    if (!boost) continue;
    if (
      !memberEligibleForLateSlot(
        m,
        date,
        admin,
        prefsMap,
        assignedToday,
        hol,
        isCongressNomineeBlocked,
        true,
      )
    ) {
      continue;
    }
    extras.push(m);
  }
  if (extras.length === 0) return pool;
  return [...extras, ...pool];
}

/** 同数化のため早番候補を広げる（午後半休・国会／国会応援の翌日） */
export function augmentPoolForEarlyEqualization(
  pool: DutyMember[],
  date: ISODateString,
  admin: AdminSettings,
  prefsMap: Record<DutyMember, PreferenceMap>,
  assignedToday: Partial<Record<DutyMember, DutySlotKind>>,
  yesterdayKind: YesterdaySlotMap,
  hol: Record<ISODateString, string>,
  isCongressNomineeBlocked: (m: DutyMember) => boolean,
): DutyMember[] {
  const inPool = new Set(pool);
  const extras: DutyMember[] = [];

  for (const m of DUTY_MEMBERS) {
    if (inPool.has(m)) continue;
    const flags = getFlags(prefsMap[m], date);
    const boost =
      flags.afternoonHalfOff || hadCongressDutyYesterday(yesterdayKind, m);
    if (!boost) continue;
    if (
      !memberEligibleForEarlySlot(
        m,
        date,
        admin,
        prefsMap,
        assignedToday,
        hol,
        isCongressNomineeBlocked,
      )
    ) {
      continue;
    }
    extras.push(m);
  }
  if (extras.length === 0) return pool;
  return [...extras, ...pool];
}

function preferBoostSubset(
  pool: DutyMember[],
  kindCounts: Record<DutyMember, number>,
  matches: (m: DutyMember) => boolean,
): DutyMember[] {
  const minC = Math.min(...pool.map((m) => kindCounts[m] ?? 0));
  const atMin = pool.filter((m) => (kindCounts[m] ?? 0) === minC);
  const boostedAtMin = atMin.filter(matches);
  if (boostedAtMin.length > 0) return boostedAtMin;
  const boosted = pool.filter(matches);
  return boosted.length > 0 ? boosted : pool;
}

/** 同数化優先: 遅番は午前半休・国会翌日・日祝翌日の候補を優先 */
export function preferLateEqualizationBoost(
  pool: DutyMember[],
  date: ISODateString,
  prefsMap: Record<DutyMember, PreferenceMap>,
  yesterdayKind: YesterdaySlotMap,
  hol: Record<ISODateString, string>,
  kindCounts: Record<DutyMember, number>,
): DutyMember[] {
  const sunHolYesterday = hadSunOrHolidayCalendarYesterday(date, hol);
  return preferBoostSubset(pool, kindCounts, (m) => {
    const flags = getFlags(prefsMap[m], date);
    return (
      flags.morningHalfOff ||
      hadCongressDutyYesterday(yesterdayKind, m) ||
      sunHolYesterday
    );
  });
}

/** 同数化優先: 早番は午後半休・国会／国会応援翌日の候補を優先 */
export function preferEarlyEqualizationBoost(
  pool: DutyMember[],
  date: ISODateString,
  prefsMap: Record<DutyMember, PreferenceMap>,
  yesterdayKind: YesterdaySlotMap,
  kindCounts: Record<DutyMember, number>,
): DutyMember[] {
  return preferBoostSubset(pool, kindCounts, (m) => {
    const flags = getFlags(prefsMap[m], date);
    return flags.afternoonHalfOff || hadCongressDutyYesterday(yesterdayKind, m);
  });
}

export function augmentPoolForEqualizationAssignment(
  pool: DutyMember[],
  slotKind: "早番" | "遅番",
  date: ISODateString,
  admin: AdminSettings,
  prefsMap: Record<DutyMember, PreferenceMap>,
  assignedToday: Partial<Record<DutyMember, DutySlotKind>>,
  yesterdayKind: YesterdaySlotMap,
  hol: Record<ISODateString, string>,
  isCongressNomineeBlocked: (m: DutyMember) => boolean,
): DutyMember[] {
  if (slotKind === "遅番") {
    return augmentPoolForLateEqualization(
      pool,
      date,
      admin,
      prefsMap,
      assignedToday,
      yesterdayKind,
      hol,
      isCongressNomineeBlocked,
    );
  }
  return augmentPoolForEarlyEqualization(
    pool,
    date,
    admin,
    prefsMap,
    assignedToday,
    yesterdayKind,
    hol,
    isCongressNomineeBlocked,
  );
}

export function preferEqualizationBoostForSlot(
  pool: DutyMember[],
  slotKind: "早番" | "遅番",
  date: ISODateString,
  prefsMap: Record<DutyMember, PreferenceMap>,
  yesterdayKind: YesterdaySlotMap,
  hol: Record<ISODateString, string>,
  kindCounts: Record<DutyMember, number>,
): DutyMember[] {
  if (slotKind === "遅番") {
    return preferLateEqualizationBoost(
      pool,
      date,
      prefsMap,
      yesterdayKind,
      hol,
      kindCounts,
    );
  }
  return preferEarlyEqualizationBoost(
    pool,
    date,
    prefsMap,
    yesterdayKind,
    kindCounts,
  );
}
