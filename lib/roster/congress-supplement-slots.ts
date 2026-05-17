import type { AdminSettings, DutyMember, ISODateString } from "@/types";
import { isWeekdayMonFri } from "./dates";
import { getFlags, type PreferenceMap } from "./eligibility";
import { holidayNameOn } from "./holidays";
import {
  lookupCongressMonthly,
  lookupCongressWeekly,
  type DemandSlot,
} from "./slots";

/**
 * 国会月番・週番の指名者がその日に午前または午後半休のとき、固定国会枠の直後へ
 * 「国会（応援）」需要枠を追加する（指名者の国会当番は維持したまま）。
 */
export function appendSupplementalCongressOuenSlots(
  baseSlots: DemandSlot[],
  admin: AdminSettings,
  date: ISODateString,
  holidayExtra: Record<ISODateString, string>,
  prefsMap: Record<DutyMember, PreferenceMap>,
): DemandSlot[] {
  if (!isWeekdayMonFri(date) || holidayNameOn(date, holidayExtra)) return baseSlots;

  let lastCongressIdx = -1;
  for (let i = 0; i < baseSlots.length; i++) {
    const k = baseSlots[i]!.kind;
    if (k === "国会月番" || k === "国会週番") lastCongressIdx = i;
  }
  if (lastCongressIdx < 0) return baseSlots;

  const monthly = lookupCongressMonthly(admin, date);
  const weekly = lookupCongressWeekly(admin, date);
  const hasMonth = baseSlots.some((s) => s.kind === "国会月番");
  const hasWeek = baseSlots.some((s) => s.kind === "国会週番");

  let n = 0;
  if (hasMonth && monthly !== undefined) {
    const f = getFlags(prefsMap[monthly], date);
    if (f.morningHalfOff || f.afternoonHalfOff) n += 1;
  }
  if (hasWeek && weekly !== undefined) {
    const f = getFlags(prefsMap[weekly], date);
    if (f.morningHalfOff || f.afternoonHalfOff) n += 1;
  }
  if (n === 0) return baseSlots;

  const inserts: DemandSlot[] = [];
  for (let i = 0; i < n; i++) {
    inserts.push({
      id: `congress-halfday-supplement-${date}-${i}`,
      kind: "国会（応援）",
    });
  }
  return [
    ...baseSlots.slice(0, lastCongressIdx + 1),
    ...inserts,
    ...baseSlots.slice(lastCongressIdx + 1),
  ];
}
