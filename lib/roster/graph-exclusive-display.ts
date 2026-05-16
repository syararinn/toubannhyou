import type { AdminSettings, DutyMember, ISODateString, RosterColumnPerson } from "@/types";
import type { PreferenceMap } from "./eligibility";
import { getFlags } from "./eligibility";
import { isGraphExclusiveForIsobe } from "./slots";

/** グラフ専任期間中の磯田列表記 */
export const ISOBE_GRAPH_EXCLUSIVE_CELL_LABEL = "グラフ";

const ISOBE: DutyMember = "磯田";

export function applyGraphExclusiveIsobeCellLabel(
  draft: Record<RosterColumnPerson, string>,
  admin: AdminSettings,
  date: ISODateString,
  prefsMap: Record<DutyMember, PreferenceMap>,
): Record<RosterColumnPerson, string> {
  if (!isGraphExclusiveForIsobe(admin, date)) return draft;
  const out = { ...draft };
  if (getFlags(prefsMap[ISOBE], date).fullDayOff) {
    out[ISOBE] = "休";
    return out;
  }
  out[ISOBE] = ISOBE_GRAPH_EXCLUSIVE_CELL_LABEL;
  return out;
}
