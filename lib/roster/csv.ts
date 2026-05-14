import type { GeneratedRosterDay } from "@/types";
import { ROSTER_COLUMN_ORDER } from "@/types";

function csvEscapeCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** A〜M 列に対応する CSV（RFC 4180 風、Excel 向けに CRLF） */
export function rosterDaysToCsv(rows: GeneratedRosterDay[]): string {
  const header = [
    "日付",
    "曜日",
    "祭日",
    "行事予定",
    ...([...ROSTER_COLUMN_ORDER] as string[]),
  ];
  const lines: string[] = [header.map(csvEscapeCell).join(",")];
  for (const row of rows) {
    const cells = ROSTER_COLUMN_ORDER.map((name) => {
      const duty = row.rosterCellsByColumnPerson[name] ?? "";
      const marks = row.preferenceMarksByColumnPerson?.[name]?.trim() ?? "";
      if (!marks) return duty;
      if (!duty) return marks;
      return `${duty}（${marks}）`;
    });
    lines.push(
      [
        row.date,
        row.weekdayLabel,
        row.nationalHolidayColumnText,
        row.eventsAndNotes,
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
