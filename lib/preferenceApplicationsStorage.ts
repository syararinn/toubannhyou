import type { DutyMember, PreferenceLimitApplication, YearMonthString } from "@/types";
import { preferenceApplicationStorageKey, preferenceApplicationHasAnyReason } from "@/lib/preferenceLimits";

export const PREFERENCE_APPLICATIONS_STORAGE_KEY = "duty-roster-preference-applications-v1";

export const PREFERENCE_APPLICATIONS_UPDATED_EVENT =
  "duty-roster-preference-applications-updated";

type ApplicationStore = Record<string, PreferenceLimitApplication>;

export function newPreferenceApplicationId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function mergeApplication(raw: unknown): PreferenceLimitApplication | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Partial<PreferenceLimitApplication>;
  if (!p.dutyMember || !p.yearMonth || !p.status || !p.submittedAt) return null;
  const id =
    typeof p.id === "string" && p.id.length > 0
      ? p.id
      : `legacy-${p.submittedAt}-${p.dutyMember}`;
  return {
    id,
    dutyMember: p.dutyMember,
    yearMonth: p.yearMonth,
    status: p.status,
    submittedAt: p.submittedAt,
    restCrossReason: typeof p.restCrossReason === "string" ? p.restCrossReason : "",
    nightReason: typeof p.nightReason === "string" ? p.nightReason : "",
    restCrossMarksAtSubmit: Number(p.restCrossMarksAtSubmit) || 0,
    nightMarksAtSubmit: Number(p.nightMarksAtSubmit) || 0,
    approvedExtraRestCross: Math.max(0, Number(p.approvedExtraRestCross) || 0),
    approvedExtraNight: Math.max(0, Number(p.approvedExtraNight) || 0),
    reviewedAt: typeof p.reviewedAt === "string" ? p.reviewedAt : undefined,
  };
}

function normalizeStoreKeys(store: ApplicationStore): ApplicationStore {
  const out: ApplicationStore = {};
  for (const [key, app] of Object.entries(store)) {
    const properKey = preferenceApplicationStorageKey(app.dutyMember, app.yearMonth, app.id);
    if (key !== properKey && out[properKey]) continue;
    out[properKey] = app;
  }
  return out;
}

export function loadPreferenceApplicationsFromStorage(): ApplicationStore {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(PREFERENCE_APPLICATIONS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: ApplicationStore = {};
    for (const [key, val] of Object.entries(parsed)) {
      const app = mergeApplication(val);
      if (!app) continue;
      const storageKey = preferenceApplicationStorageKey(
        app.dutyMember,
        app.yearMonth,
        app.id,
      );
      out[storageKey] = app;
    }
    return normalizeStoreKeys(out);
  } catch {
    return {};
  }
}

export function savePreferenceApplicationsToStorage(store: ApplicationStore): void {
  if (typeof window === "undefined") return;
  try {
    const normalized = normalizeStoreKeys(store);
    window.localStorage.setItem(
      PREFERENCE_APPLICATIONS_STORAGE_KEY,
      JSON.stringify(normalized),
    );
    window.dispatchEvent(new Event(PREFERENCE_APPLICATIONS_UPDATED_EVENT));
  } catch {
    /* ignore */
  }
}

export function listApplicationsForMemberMonth(
  store: ApplicationStore,
  dutyMember: DutyMember,
  yearMonth: YearMonthString,
): PreferenceLimitApplication[] {
  return Object.values(store)
    .filter((a) => a.dutyMember === dutyMember && a.yearMonth === yearMonth)
    .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
}

/** @deprecated 複数申請対応のため listApplicationsForMemberMonth を使用 */
export function getPreferenceApplication(
  store: ApplicationStore,
  dutyMember: DutyMember,
  yearMonth: YearMonthString,
): PreferenceLimitApplication | undefined {
  const list = listApplicationsForMemberMonth(store, dutyMember, yearMonth);
  return list[list.length - 1];
}

export function upsertPreferenceApplication(
  application: PreferenceLimitApplication,
): PreferenceLimitApplication {
  if (
    application.status === "pending" &&
    !preferenceApplicationHasAnyReason(
      application.restCrossReason,
      application.nightReason,
    )
  ) {
    throw new Error(
      "休・✖ または夜✖ のいずれかについて、理由を入力してください。",
    );
  }
  const store = loadPreferenceApplicationsFromStorage();
  const key = preferenceApplicationStorageKey(
    application.dutyMember,
    application.yearMonth,
    application.id,
  );
  store[key] = application;
  savePreferenceApplicationsToStorage(store);
  return application;
}

export function listPreferenceApplicationsSorted(
  store?: ApplicationStore,
): PreferenceLimitApplication[] {
  const s = store ?? loadPreferenceApplicationsFromStorage();
  return Object.values(s).sort((a, b) => {
    const ym = b.yearMonth.localeCompare(a.yearMonth);
    if (ym !== 0) return ym;
    return b.submittedAt.localeCompare(a.submittedAt);
  });
}
