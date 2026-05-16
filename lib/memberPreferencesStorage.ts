import type {
  AdminSettings,
  DutyMember,
  ISODateString,
  MemberDayPreferenceFlags,
  MemberPreferenceInput,
} from "@/types";
import { ROSTER_COLUMN_ORDER } from "@/types";
import { emptyPreferenceFlags, sanitizeSameDayPreferenceFlags } from "@/lib/preferenceLimits";

export const MEMBER_PREFERENCES_STORAGE_KEY = "duty-roster-member-preferences-v1";

export const MEMBER_PREFERENCES_UPDATED_EVENT = "duty-roster-member-preferences-updated";

const DUTY_MEMBERS = ROSTER_COLUMN_ORDER.filter(
  (name): name is DutyMember => name !== "牛田" && name !== "倉科",
);

export type MemberPreferencesStore = Record<
  DutyMember,
  Record<ISODateString, MemberDayPreferenceFlags>
>;

function mergeFlags(raw: unknown): MemberDayPreferenceFlags | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Partial<MemberDayPreferenceFlags>;
  return {
    fullDayOff: Boolean(p.fullDayOff),
    fullyUnavailable: Boolean(p.fullyUnavailable),
    morningHalfOff: Boolean(p.morningHalfOff),
    afternoonHalfOff: Boolean(p.afternoonHalfOff),
    nightUnavailable: Boolean(p.nightUnavailable),
  };
}

export function emptyMemberPreferencesStore(): MemberPreferencesStore {
  const init = {} as MemberPreferencesStore;
  for (const m of DUTY_MEMBERS) {
    init[m] = {};
  }
  return init;
}

export function loadMemberPreferencesFromStorage(): MemberPreferencesStore {
  const base = emptyMemberPreferencesStore();
  if (typeof window === "undefined") return base;
  try {
    const raw = window.localStorage.getItem(MEMBER_PREFERENCES_STORAGE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return base;
    for (const m of DUTY_MEMBERS) {
      const memberRaw = (parsed as Record<string, unknown>)[m];
      if (!memberRaw || typeof memberRaw !== "object") continue;
      for (const [date, flagsRaw] of Object.entries(memberRaw)) {
        const flags = mergeFlags(flagsRaw);
        if (flags && Object.values(flags).some(Boolean)) {
          base[m][date as ISODateString] = sanitizeSameDayPreferenceFlags(flags);
        }
      }
    }
    return base;
  } catch {
    return base;
  }
}

export function saveMemberPreferencesToStorage(store: MemberPreferencesStore): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MEMBER_PREFERENCES_STORAGE_KEY, JSON.stringify(store));
    window.dispatchEvent(new Event(MEMBER_PREFERENCES_UPDATED_EVENT));
  } catch {
    /* ignore */
  }
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function lastDayOfMonth(yearMonth: string): number {
  const [y, m] = yearMonth.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

function monthStart(yearMonth: string): ISODateString {
  return `${yearMonth}-01`;
}

function monthEnd(yearMonth: string): ISODateString {
  const last = lastDayOfMonth(yearMonth);
  return `${yearMonth}-${pad2(last)}`;
}

/** 当番生成 API 向けにストアを変換 */
export function memberPreferencesStoreToGenerateInput(
  store: MemberPreferencesStore,
): Partial<Record<DutyMember, MemberPreferenceInput>> {
  const out: Partial<Record<DutyMember, MemberPreferenceInput>> = {};
  for (const m of DUTY_MEMBERS) {
    const entries = Object.entries(store[m])
      .filter(([, flags]) => Object.values(flags).some(Boolean))
      .map(([date, flags]) => ({
        date: date as ISODateString,
        flags,
      }));
    if (entries.length > 0) {
      out[m] = { dutyMember: m, entries };
    }
  }
  return out;
}

/** 希望・管理者設定から生成期間（該当月の初日〜末日）を推定 */
export function computeRosterRangeFromSavedData(
  store: MemberPreferencesStore,
  admin: AdminSettings,
): { start: ISODateString; end: ISODateString; yearMonths: string[] } | null {
  const yearMonths = new Set<string>();

  for (const m of DUTY_MEMBERS) {
    for (const date of Object.keys(store[m])) {
      yearMonths.add(date.slice(0, 7));
    }
  }
  for (const p of admin.dietSessions) {
    yearMonths.add(p.start.slice(0, 7));
    yearMonths.add(p.end.slice(0, 7));
  }
  for (const a of admin.congressMonthlyAssignments) {
    yearMonths.add(a.yearMonth);
  }
  for (const a of admin.congressWeeklyAssignments) {
    yearMonths.add(a.yearMonth);
  }

  if (yearMonths.size === 0) return null;

  const sorted = [...yearMonths].sort();
  return {
    yearMonths: sorted,
    start: monthStart(sorted[0]!),
    end: monthEnd(sorted[sorted.length - 1]!),
  };
}

export function countStoredPreferenceDays(store: MemberPreferencesStore): number {
  let n = 0;
  for (const m of DUTY_MEMBERS) {
    n += Object.keys(store[m]).length;
  }
  return n;
}
