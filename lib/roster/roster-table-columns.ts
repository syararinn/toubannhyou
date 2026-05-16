import type { GeneratedRosterDay, ISODateString } from "@/types";

/** 表の A 列用：月見出し行とあわせて「日」のみ表示するための日（1〜31） */
export function dayOfMonthLabel(iso: ISODateString): string {
  const d = parseInt(iso.slice(8, 10), 10);
  return Number.isFinite(d) ? String(d) : iso.slice(8);
}

/** C 列（行事）用：行事予定と祭日をまとめて表示。重複は1つに。 */
export function rosterCombinedEventsText(row: GeneratedRosterDay): string {
  const ev = row.eventsAndNotes?.trim() ?? "";
  const hol = row.nationalHolidayColumnText?.trim() ?? "";
  if (!ev) return hol;
  if (!hol) return ev;
  if (ev === hol || ev.includes(hol)) return ev;
  if (hol.includes(ev)) return hol;
  return `${ev}\n${hol}`;
}
