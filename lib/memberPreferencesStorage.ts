import type { DutyMember, ISODateString, MemberDayPreferenceFlags } from "@/types";
import { ROSTER_COLUMN_ORDER } from "@/types";
import { emptyPreferenceFlags } from "@/lib/preferenceLimits";

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
          base[m][date as ISODateString] = flags;
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
