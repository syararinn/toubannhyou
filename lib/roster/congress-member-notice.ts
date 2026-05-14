import type { AdminSettings, DutyMember, ISODateString } from "@/types";
import { mondayBasedWeekIndexInMonth, yearMonthFromIso } from "./congress-week";
import { isWeekdayMonFri } from "./dates";

function isInAnyDietSession(admin: AdminSettings, date: ISODateString): boolean {
  return admin.dietSessions.some((p) => date >= p.start && date <= p.end);
}

/**
 * 選択部員がその平日に国会月当番／国会週当番として事前指定されているか（管理者設定ベース）
 */
export function getMemberCongressDutyLabels(
  admin: AdminSettings,
  date: ISODateString,
  member: DutyMember,
): string[] {
  if (!isWeekdayMonFri(date)) return [];
  const ym = yearMonthFromIso(date);
  const labels: string[] = [];
  const monthly = admin.congressMonthlyAssignments.find((a) => a.yearMonth === ym)?.dutyMember;
  if (monthly === member) {
    labels.push("この日は国会月当番です（管理者が事前に固定指定）。");
  }
  if (isInAnyDietSession(admin, date)) {
    const wk = mondayBasedWeekIndexInMonth(date);
    const weekly = admin.congressWeeklyAssignments.find(
      (a) => a.yearMonth === ym && a.weekIndexInMonth === wk,
    )?.dutyMember;
    if (weekly === member) {
      labels.push("この日は国会週当番です（管理者が事前に固定指定）。");
    }
  }
  return labels;
}
