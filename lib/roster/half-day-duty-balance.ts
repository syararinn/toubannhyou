import type { AdminSettings, DutyMember, ISODateString } from "@/types";
import { DUTY_MEMBER_RANK_ORDER_BY_MEMBER } from "@/types";
import {
  getFlags,
  isMemberExcludedGlobally,
  type PreferenceMap,
  violatesHardPreference,
  violatesInterval,
  type YesterdaySlotMap,
} from "./eligibility";
import type { DutySlotKind } from "./slots";
import { isExcludedFromWeeklyEarlyLateBalance } from "./weekly-early-late-balance";

const DUTY_MEMBERS: DutyMember[] = (
  Object.keys(DUTY_MEMBER_RANK_ORDER_BY_MEMBER) as DutyMember[]
).sort(
  (a, b) => DUTY_MEMBER_RANK_ORDER_BY_MEMBER[a] - DUTY_MEMBER_RANK_ORDER_BY_MEMBER[b],
);

export function isPoolDutyCountImbalanced(
  pool: DutyMember[],
  kindCounts: Record<DutyMember, number>,
): boolean {
  if (pool.length < 2) return false;
  let min = Infinity;
  let max = -Infinity;
  for (const m of pool) {
    const c = kindCounts[m] ?? 0;
    if (c < min) min = c;
    if (c > max) max = c;
  }
  return max > min;
}

/** 遅番用: 午前半休者を候補に加える（ソフト制約のみで外れていた場合） */
function augmentPoolWithMorningHalfForLate(
  pool: DutyMember[],
  date: ISODateString,
  admin: AdminSettings,
  prefsMap: Record<DutyMember, PreferenceMap>,
  assignedToday: Partial<Record<DutyMember, DutySlotKind>>,
  yesterdayKind: YesterdaySlotMap,
  hol: Record<ISODateString, string>,
): DutyMember[] {
  const inPool = new Set(pool);
  const extras: DutyMember[] = [];
  for (const m of DUTY_MEMBERS) {
    if (inPool.has(m)) continue;
    if (!getFlags(prefsMap[m], date).morningHalfOff) continue;
    if (isMemberExcludedGlobally(admin, m, date)) continue;
    if (isExcludedFromWeeklyEarlyLateBalance(admin, date, m, hol)) continue;
    if (assignedToday[m] !== undefined) continue;
    if (violatesHardPreference(getFlags(prefsMap[m], date), "遅番", date, hol)) continue;
    if (violatesInterval("遅番", yesterdayKind, m)) continue;
    extras.push(m);
  }
  if (extras.length === 0) return pool;
  return [...extras, ...pool];
}

/**
 * 当番回数が偏っているとき、半休と相性のよい枠へ優先配分（午前半休→遅番、午後半休→早番）。
 * 部員非公開・努力目標。候補がいない場合は pool をそのまま返す。
 */
export function preferHalfDayForDutyCountBalance(
  pool: DutyMember[],
  slotKind: "早番" | "遅番",
  date: ISODateString,
  prefsMap: Record<DutyMember, PreferenceMap>,
  kindCounts: Record<DutyMember, number>,
): DutyMember[] {
  if (!isPoolDutyCountImbalanced(pool, kindCounts)) return pool;

  const minC = Math.min(...pool.map((m) => kindCounts[m] ?? 0));
  const atMin = pool.filter((m) => (kindCounts[m] ?? 0) === minC);

  if (slotKind === "遅番") {
    const morningAtMin = atMin.filter((m) => getFlags(prefsMap[m], date).morningHalfOff);
    if (morningAtMin.length > 0) return morningAtMin;
    const morning = pool.filter((m) => getFlags(prefsMap[m], date).morningHalfOff);
    return morning.length > 0 ? morning : pool;
  }

  const afternoonAtMin = atMin.filter((m) => getFlags(prefsMap[m], date).afternoonHalfOff);
  if (afternoonAtMin.length > 0) return afternoonAtMin;
  const afternoon = pool.filter((m) => getFlags(prefsMap[m], date).afternoonHalfOff);
  return afternoon.length > 0 ? afternoon : pool;
}

/** 早番・遅番の割当前に、不均衡時の半休優先のため候補を広げる */
export function applyHalfDayDutyCountBalancePrefs(
  pool: DutyMember[],
  slotKind: DutySlotKind,
  date: ISODateString,
  admin: AdminSettings,
  prefsMap: Record<DutyMember, PreferenceMap>,
  earlyLateCounts: { early: Record<DutyMember, number>; late: Record<DutyMember, number> },
  assignedToday: Partial<Record<DutyMember, DutySlotKind>>,
  yesterdayKind: YesterdaySlotMap,
  hol: Record<ISODateString, string>,
): DutyMember[] {
  if (slotKind !== "早番" && slotKind !== "遅番") return pool;
  const kindCounts =
    slotKind === "早番" ? earlyLateCounts.early : earlyLateCounts.late;
  if (!isPoolDutyCountImbalanced(pool, kindCounts)) return pool;

  let expanded = pool;
  if (slotKind === "遅番") {
    expanded = augmentPoolWithMorningHalfForLate(
      pool,
      date,
      admin,
      prefsMap,
      assignedToday,
      yesterdayKind,
      hol,
    );
  }

  return preferHalfDayForDutyCountBalance(
    expanded,
    slotKind,
    date,
    prefsMap,
    kindCounts,
  );
}
