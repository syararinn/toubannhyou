import type { AdminSettings, DutyMember, ISODateString, RosterColumnPerson } from "@/types";
import { isWeekdayMonFri } from "./dates";
import { holidayNameOn } from "./holidays";
import type { PreferenceMap } from "./eligibility";
import { getFlags } from "./eligibility";
import { lookupCongressMonthly, lookupCongressWeekly } from "./slots";

/** 完成版当番表・CSV に出す国会指名者の表記 */
export const CONGRESS_NOMINATION_CELL_LABEL = "国会当番";

const INTERNAL_CONGRESS_LABELS = new Set([
  "国会月番",
  "国会週番",
  "国会",
]);

/**
 * 管理者が国会月番／週番に指名した部員で、その平日（祝日を除く）に当番表へ印字する対象か。
 */
export function isAdminCongressNomineeOnWeekday(
  admin: AdminSettings,
  date: ISODateString,
  member: DutyMember,
  holidayMap: Record<ISODateString, string>,
): boolean {
  if (!isWeekdayMonFri(date)) return false;
  if (holidayNameOn(date, holidayMap)) return false;
  if (lookupCongressMonthly(admin, date) === member) return true;
  if (lookupCongressWeekly(admin, date) === member) return true;
  return false;
}

function cellShowsFullDayOff(cell: string): boolean {
  return cell.split("・").some((p) => p === "休");
}

/**
 * 指名者列に「国会当番」を反映（休み申請日は「休」のまま）。
 */
export function applyCongressNominationCellLabels(
  draft: Record<RosterColumnPerson, string>,
  admin: AdminSettings,
  date: ISODateString,
  prefsMap: Record<DutyMember, PreferenceMap>,
  holidayMap: Record<ISODateString, string>,
): Record<RosterColumnPerson, string> {
  const out = { ...draft };
  const monthly = lookupCongressMonthly(admin, date);
  const weekly = lookupCongressWeekly(admin, date);
  const nominees = new Set<DutyMember>();
  if (monthly) nominees.add(monthly);
  if (weekly) nominees.add(weekly);

  for (const member of nominees) {
    if (!isAdminCongressNomineeOnWeekday(admin, date, member, holidayMap)) continue;
    if (getFlags(prefsMap[member], date).fullDayOff) continue;

    const cur = (out[member] ?? "").trim();
    if (cellShowsFullDayOff(cur)) continue;

    const kept = cur
      .split("・")
      .filter(
        (p) =>
          p &&
          p !== CONGRESS_NOMINATION_CELL_LABEL &&
          !INTERNAL_CONGRESS_LABELS.has(p),
      )
      .join("・");
    out[member] = kept
      ? `${kept}・${CONGRESS_NOMINATION_CELL_LABEL}`
      : CONGRESS_NOMINATION_CELL_LABEL;
  }

  return out;
}
