import type {
  AdminSettings,
  DutyMember,
  ISODateString,
  MemberDayPreferenceFlags,
} from "@/types";
import { isSaturday, isSunday } from "./dates";
import { holidayNameOn } from "./holidays";
import type { DutySlotKind } from "./slots";
import {
  isAdminNominatedCongressDutyKind,
  isCongressSlotKind,
  isGraphExclusiveForIsobe,
  slotIsEarlyLike,
} from "./slots";

export type PreferenceMap = Record<ISODateString, MemberDayPreferenceFlags>;

export function emptyPreferenceFlags(): MemberDayPreferenceFlags {
  return {
    fullDayOff: false,
    fullyUnavailable: false,
    morningHalfOff: false,
    afternoonHalfOff: false,
    nightUnavailable: false,
  };
}

export function preferencesToMap(
  entries: { date: ISODateString; flags: MemberDayPreferenceFlags }[],
): PreferenceMap {
  const m: PreferenceMap = {};
  for (const e of entries) {
    m[e.date] = e.flags;
  }
  return m;
}

export function isMemberExcludedGlobally(
  admin: AdminSettings,
  member: DutyMember,
  date: ISODateString,
): boolean {
  if (admin.secondmentByDutyMember[member] === "on_loan") return true;
  if (member === "磯田" && isGraphExclusiveForIsobe(admin, date)) return true;
  return false;
}

export function getFlags(
  prefs: PreferenceMap,
  date: ISODateString,
): MemberDayPreferenceFlags {
  return prefs[date] ?? emptyPreferenceFlags();
}

function isCongressKind(kind: DutySlotKind): boolean {
  return isCongressSlotKind(kind);
}

/** 夜✖️で「休日出勤」とみなすメイン枠（土日祝。平日祝のメインも含む） */
function isHolidayAttendanceMainForNight(
  kind: DutySlotKind,
  date: ISODateString,
  holidayExtra: Record<ISODateString, string>,
): boolean {
  if (kind !== "メイン") return false;
  return isSaturday(date) || isSunday(date) || Boolean(holidayNameOn(date, holidayExtra));
}

/** 午後半休がハードで不可になる枠（国会月番・週番・無印「国会」は指名枠のため除外し、応援のみ国会系として扱う） */
function afternoonHalfOffBlocksSlotKind(kind: DutySlotKind): boolean {
  if (kind === "遅番" || kind === "予備") return true;
  if (isCongressSlotKind(kind) && !isAdminNominatedCongressDutyKind(kind)) return true;
  return false;
}

/**
 * 休・✖️: いかなる枠にも不可。
 * 午前半休: 早番・メイン（午前出勤が前提の枠）には不可。国会月番・週番・国会（指名枠）は可（半休時の人手は別途「国会（応援）」枠で補う）。
 * 午後半休: 遅番・予備・国会（応援）には不可。国会月番・週番・国会（指名枠）は可。
 * 夜✖️: 遅番と休日出勤（土日祝のメイン枠）のみ不可。
 */
export function violatesHardPreference(
  flags: MemberDayPreferenceFlags,
  kind: DutySlotKind,
  date: ISODateString,
  holidayExtra: Record<ISODateString, string>,
): boolean {
  if (flags.fullDayOff || flags.fullyUnavailable) return true;
  if (flags.morningHalfOff && slotIsEarlyLike(kind)) return true;
  if (flags.afternoonHalfOff && afternoonHalfOffBlocksSlotKind(kind)) return true;
  if (flags.nightUnavailable) {
    if (kind === "遅番") return true;
    if (isHolidayAttendanceMainForNight(kind, date, holidayExtra)) return true;
  }
  return false;
}

/** 午前半休の「遅番相当」回避（ソフト） */
export function violatesMorningHalfOnLateSlot(
  flags: MemberDayPreferenceFlags,
  kind: DutySlotKind,
): boolean {
  if (!flags.morningHalfOff) return false;
  if (kind === "遅番" || kind === "予備" || isCongressKind(kind)) return true;
  return false;
}

/** 前日に実際に割り当てられた勤務種別のみ（未割当はキーなし） */
export type YesterdaySlotMap = Partial<Record<DutyMember, DutySlotKind>>;

/** 前日が遅番または予備（国会系は含めない） */
export function hadLateShiftYesterday(
  lastKindByMember: YesterdaySlotMap,
  member: DutyMember,
): boolean {
  const k = lastKindByMember[member];
  return k === "遅番" || k === "予備";
}

/** 前日が国会・国会月番・国会週番・国会（応援）のいずれか */
export function hadCongressDutyYesterday(
  lastKindByMember: YesterdaySlotMap,
  member: DutyMember,
): boolean {
  const k = lastKindByMember[member];
  return k !== undefined && isCongressSlotKind(k);
}

/** @deprecated インターバル判定は hadLateShiftYesterday を使用 */
export function hadLateLikeYesterday(
  lastKindByMember: YesterdaySlotMap,
  member: DutyMember,
): boolean {
  return hadLateShiftYesterday(lastKindByMember, member);
}

/** 遅番・予備の翌日は早番不可。国会系の翌日は早番可（同数化で早番に回す）。 */
export function violatesInterval(
  kind: DutySlotKind,
  lastKindByMember: YesterdaySlotMap,
  member: DutyMember,
): boolean {
  if (!slotIsEarlyLike(kind)) return false;
  return hadLateShiftYesterday(lastKindByMember, member);
}

/** @see compareForDutyCountAssignment — 部員非公開の当番回数調整 */
export { compareForDutyCountAssignment as compareForAssignment } from "./duty-count-assignment";
