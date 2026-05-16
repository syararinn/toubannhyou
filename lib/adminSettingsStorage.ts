import type {
  AdminSettings,
  DutyMember,
  ISODateString,
  NationalHolidayManualEntry,
  NewspaperNonPublicationAssignee,
  NewspaperNonPublicationWorkDay,
} from "@/types";
import { DUTY_MEMBER_RANK_PRIORITY_ORDER } from "@/types";

export const ADMIN_SETTINGS_STORAGE_KEY = "duty-roster-admin-settings-v1";

export const ADMIN_SETTINGS_UPDATED_EVENT = "duty-roster-admin-settings-updated";

const DUTY_MEMBER_SET = new Set<string>(
  DUTY_MEMBER_RANK_PRIORITY_ORDER as readonly string[],
);

function parseSingleNewspaperAssignee(raw: unknown): NewspaperNonPublicationAssignee | null {
  if (raw === "倉科") return "倉科";
  if (typeof raw === "string" && DUTY_MEMBER_SET.has(raw)) return raw as DutyMember;
  return null;
}

/** 旧形式: assignedDutyMembers の先頭のみ採用 */
function parseAssigneeFromLegacyRow(row: {
  date: string;
  assignee?: unknown;
  assignedDutyMembers?: unknown;
}): NewspaperNonPublicationAssignee | null {
  const direct = parseSingleNewspaperAssignee(row.assignee);
  if (direct) return direct;
  if (!Array.isArray(row.assignedDutyMembers)) return null;
  for (const x of row.assignedDutyMembers) {
    const one = parseSingleNewspaperAssignee(x);
    if (one) return one;
  }
  return null;
}

function dedupeNewspaperDaysByDate(
  rows: NewspaperNonPublicationWorkDay[],
): NewspaperNonPublicationWorkDay[] {
  const by = new Map<string, NewspaperNonPublicationWorkDay>();
  for (const r of rows) {
    const prev = by.get(r.date);
    const assignee = r.assignee != null ? r.assignee : (prev?.assignee ?? null);
    by.set(r.date, { date: r.date, assignee });
  }
  return [...by.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function normalizeNewspaperWorkDays(
  p: Partial<AdminSettings> & {
    newspaperNonPublicationWorkDates?: unknown;
  },
): NewspaperNonPublicationWorkDay[] {
  if (Array.isArray(p.newspaperNonPublicationWorkDays)) {
    const rows: NewspaperNonPublicationWorkDay[] = [];
    for (const row of p.newspaperNonPublicationWorkDays) {
      if (!row || typeof row !== "object") continue;
      const r = row as {
        date?: unknown;
        assignee?: unknown;
        assignedDutyMembers?: unknown;
      };
      if (typeof r.date !== "string" || r.date.length < 8) continue;
      rows.push({
        date: r.date,
        assignee: parseAssigneeFromLegacyRow({
          date: r.date,
          assignee: r.assignee,
          assignedDutyMembers: r.assignedDutyMembers,
        }),
      });
    }
    return dedupeNewspaperDaysByDate(rows);
  }
  const legacy = p.newspaperNonPublicationWorkDates;
  if (Array.isArray(legacy)) {
    return dedupeNewspaperDaysByDate(
      legacy
        .filter((d): d is ISODateString => typeof d === "string" && d.length >= 8)
        .map((date) => ({ date, assignee: null })),
    );
  }
  return [];
}

function normalizeNationalHolidaysManual(raw: unknown): NationalHolidayManualEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: NationalHolidayManualEntry[] = [];
  for (const e of raw) {
    if (!e || typeof e !== "object") continue;
    const row = e as { date?: unknown; name?: unknown };
    if (typeof row.date !== "string" || typeof row.name !== "string") continue;
    const date = row.date.trim();
    const name = row.name.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !name) continue;
    out.push({ date, name });
  }
  return out;
}

export function defaultAdminSettings(): AdminSettings {
  return {
    dietSessions: [],
    nationalHolidaysManual: [],
    newspaperNonPublicationWorkDays: [],
    graphExclusivePeriodsForIsobe: [],
    secondmentByDutyMember: {
      磯田: "active",
      江田: "active",
      鈴木: "active",
      南: "active",
      千葉: "active",
      大久保: "active",
      中嶋: "active",
    },
    dailyAttendanceOverrides: [],
    congressMonthlyAssignments: [],
    congressWeeklyAssignments: [],
  };
}

function mergeAdminParsed(raw: unknown): AdminSettings {
  const d = defaultAdminSettings();
  if (!raw || typeof raw !== "object") return d;
  const p = raw as Partial<AdminSettings> & { newspaperNonPublicationWorkDates?: unknown };
  return {
    ...d,
    ...p,
    dietSessions: Array.isArray(p.dietSessions) ? p.dietSessions : d.dietSessions,
    newspaperNonPublicationWorkDays: normalizeNewspaperWorkDays(p),
    nationalHolidaysManual: normalizeNationalHolidaysManual(p.nationalHolidaysManual),
    graphExclusivePeriodsForIsobe: Array.isArray(p.graphExclusivePeriodsForIsobe)
      ? p.graphExclusivePeriodsForIsobe
      : d.graphExclusivePeriodsForIsobe,
    secondmentByDutyMember: {
      ...d.secondmentByDutyMember,
      ...(p.secondmentByDutyMember ?? {}),
    },
    dailyAttendanceOverrides: Array.isArray(p.dailyAttendanceOverrides)
      ? p.dailyAttendanceOverrides
      : d.dailyAttendanceOverrides,
    congressMonthlyAssignments: Array.isArray(p.congressMonthlyAssignments)
      ? p.congressMonthlyAssignments
      : d.congressMonthlyAssignments,
    congressWeeklyAssignments: Array.isArray(p.congressWeeklyAssignments)
      ? p.congressWeeklyAssignments
      : d.congressWeeklyAssignments,
  };
}

export function loadAdminSettingsFromStorage(): AdminSettings {
  if (typeof window === "undefined") return defaultAdminSettings();
  try {
    const raw = window.localStorage.getItem(ADMIN_SETTINGS_STORAGE_KEY);
    if (!raw) return defaultAdminSettings();
    return mergeAdminParsed(JSON.parse(raw));
  } catch {
    return defaultAdminSettings();
  }
}

export function saveAdminSettingsToStorage(settings: AdminSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ADMIN_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    window.dispatchEvent(new Event(ADMIN_SETTINGS_UPDATED_EVENT));
  } catch {
    /* ignore quota / private mode */
  }
}
