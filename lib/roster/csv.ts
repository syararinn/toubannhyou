import type { GeneratedRosterDay } from "@/types";
import { ROSTER_COLUMN_ORDER } from "@/types";
import { formatRosterDutyCellText } from "./roster-cell-display";
import {
  dayOfMonthLabel,
  rosterCombinedEventsText,
} from "./roster-table-columns";

function csvEscapeCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** 表 A〜C 列＋管理職列に対応する CSV（RFC 4180 風、Excel 向けに CRLF）。管理職列数は `ROSTER_COLUMN_ORDER` に追従 */
export function rosterDaysToCsv(rows: GeneratedRosterDay[]): string {
  const header = [
    "日付",
    "日",
    "曜日",
    "行事",
    ...([...ROSTER_COLUMN_ORDER] as string[]),
  ];
  const lines: string[] = [header.map(csvEscapeCell).join(",")];
  for (const row of rows) {
    const cells = ROSTER_COLUMN_ORDER.map((name) => {
      const duty = formatRosterDutyCellText(
        row.rosterCellsByColumnPerson[name] ?? "",
        row,
      );
      const marks = row.preferenceMarksByColumnPerson?.[name]?.trim() ?? "";
      if (!marks) return duty;
      if (!duty) return marks;
      return `${duty}（${marks}）`;
    });
    lines.push(
      [
        row.date,
        dayOfMonthLabel(row.date),
        row.weekdayLabel,
        rosterCombinedEventsText(row),
        ...cells,
      ]
        .map(csvEscapeCell)
        .join(","),
    );
  }
  return lines.join("\r\n");
}

export function csvWithUtf8Bom(csv: string): string {
  return `\uFEFF${csv}`;
}
