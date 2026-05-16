import type { GeneratedRosterDay } from "@/types";

/** 土・日・祝（振替休日含む）行では「メイン」を「出勤」と表す */
export function shouldDisplayMainAsAttendance(row: GeneratedRosterDay): boolean {
  if (row.weekdayLabel === "土") return true;
  if (row.isRestDayPastelPinkRow !== undefined) return row.isRestDayPastelPinkRow;
  if (row.weekdayLabel === "日") return true;
  return Boolean(row.nationalHolidayColumnText?.trim());
}

/** 完成版当番表・CSV 向けのセル表記（メイン→出勤の置換を含む） */
export function formatRosterDutyCellText(raw: string, row: GeneratedRosterDay): string {
  if (!raw) return "";
  if (!shouldDisplayMainAsAttendance(row)) return raw;
  return raw
    .split("・")
    .map((segment) => (segment === "メイン" ? "出勤" : segment))
    .join("・");
}
