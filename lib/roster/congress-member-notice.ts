import type { AdminSettings, DutyMember, ISODateString } from "@/types";
import { mondayBasedWeekIndexInMonth, yearMonthFromIso } from "./congress-week";
import { isWeekdayMonFri } from "./dates";
import { holidayNameOn } from "./holidays";
import { isInAnyDietSession, weekBlockIntersectsDietSession } from "./slots";

/**
 * 選択部員がその平日に国会月当番／国会週当番として事前指定されているか（管理者設定ベース）。
 * 国民の祝日・振替休日等が月〜金に重なる日は国会当番扱いにしない（当番表はメイン・予備の休日枠）。
 */
export function getMemberCongressDutyLabels(
  admin: AdminSettings,
  date: ISODateString,
  member: DutyMember,
  holidayMap: Record<ISODateString, string>,
): string[] {
  if (!isWeekdayMonFri(date)) return [];
  if (holidayNameOn(date, holidayMap)) return [];
  const ym = yearMonthFromIso(date);
  const labels: string[] = [];
  const monthly = admin.congressMonthlyAssignments.find((a) => a.yearMonth === ym)?.dutyMember;
  if (monthly === member) {
    labels.push("この日は国会月当番です。");
  }
  if (isInAnyDietSession(admin, date) || weekBlockIntersectsDietSession(admin, date)) {
    const wk = mondayBasedWeekIndexInMonth(date);
    const weekly = admin.congressWeeklyAssignments.find(
      (a) => a.yearMonth === ym && a.weekIndexInMonth === wk,
    )?.dutyMember;
    if (weekly === member) {
      labels.push("この日は国会週当番です。");
    }
  }
  return labels;
}
