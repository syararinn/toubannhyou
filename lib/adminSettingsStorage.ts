import type { AdminSettings } from "@/types";

export const ADMIN_SETTINGS_STORAGE_KEY = "duty-roster-admin-settings-v1";

export const ADMIN_SETTINGS_UPDATED_EVENT = "duty-roster-admin-settings-updated";

export function defaultAdminSettings(): AdminSettings {
  return {
    dietSessions: [],
    newspaperNonPublicationWorkDates: [],
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
  const p = raw as Partial<AdminSettings>;
  return {
    ...d,
    ...p,
    dietSessions: Array.isArray(p.dietSessions) ? p.dietSessions : d.dietSessions,
    newspaperNonPublicationWorkDates: Array.isArray(p.newspaperNonPublicationWorkDates)
      ? p.newspaperNonPublicationWorkDates
      : d.newspaperNonPublicationWorkDates,
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
