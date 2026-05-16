"use client";

import { useEffect, useMemo, useState } from "react";
import type { PreferenceLimitApplication } from "@/types";
import {
  MAX_APPROVED_EXTRA_NIGHT_MARKS,
  MAX_APPROVED_EXTRA_REST_CROSS_MARKS,
} from "@/types";
import { applicationKindSummary } from "@/lib/preferenceApplicationKind";
import {
  listPreferenceApplicationsSorted,
  loadPreferenceApplicationsFromStorage,
  PREFERENCE_APPLICATIONS_UPDATED_EVENT,
  upsertPreferenceApplication,
} from "@/lib/preferenceApplicationsStorage";

const btnPrimary =
  "inline-flex shrink-0 items-center justify-center rounded-md bg-neutral-900 px-2.5 py-1 text-xs font-medium text-white shadow-sm transition hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white";

const btnDanger =
  "inline-flex shrink-0 items-center justify-center rounded-md border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-700 transition hover:bg-red-50 dark:border-red-900/60 dark:bg-neutral-900 dark:text-red-400 dark:hover:bg-red-950/40";

const inputTiny =
  "w-12 rounded border border-neutral-300 bg-white px-1 py-0.5 text-center text-xs tabular-nums text-neutral-900 outline-none focus:border-neutral-500 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100";

function parseExtra(raw: string, max: number): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > max || !Number.isInteger(n)) return null;
  return n;
}

function CompactPendingRow({
  app,
  onUpdated,
}: {
  app: PreferenceLimitApplication;
  onUpdated: () => void;
}) {
  const [extraRestCross, setExtraRestCross] = useState(
    String(app.approvedExtraRestCross || 0),
  );
  const [extraNight, setExtraNight] = useState(String(app.approvedExtraNight || 0));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setExtraRestCross(String(app.approvedExtraRestCross || 0));
    setExtraNight(String(app.approvedExtraNight || 0));
  }, [app]);

  const kind = applicationKindSummary(app);
  const bothKindsUnknown = !kind.restCross && !kind.night;
  const showRestPanel = kind.restCross || bothKindsUnknown;
  const showNightPanel = kind.night || bothKindsUnknown;

  function approve() {
    let approvedRest = 0;
    let approvedNight = 0;
    if (showRestPanel) {
      const parsed = parseExtra(extraRestCross, MAX_APPROVED_EXTRA_REST_CROSS_MARKS);
      if (parsed === null) {
        setError(`休・✖ は 0〜${MAX_APPROVED_EXTRA_REST_CROSS_MARKS} の整数`);
        return;
      }
      approvedRest = parsed;
    }
    if (showNightPanel) {
      const parsed = parseExtra(extraNight, MAX_APPROVED_EXTRA_NIGHT_MARKS);
      if (parsed === null) {
        setError(`夜✖ は 0〜${MAX_APPROVED_EXTRA_NIGHT_MARKS} の整数`);
        return;
      }
      approvedNight = parsed;
    }
    setError(null);
    upsertPreferenceApplication({
      ...app,
      status: "approved",
      approvedExtraRestCross: approvedRest,
      approvedExtraNight: approvedNight,
      reviewedAt: new Date().toISOString(),
    });
    onUpdated();
  }

  function reject() {
    setError(null);
    upsertPreferenceApplication({
      ...app,
      status: "rejected",
      approvedExtraRestCross: 0,
      approvedExtraNight: 0,
      reviewedAt: new Date().toISOString(),
    });
    onUpdated();
  }

  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1.5 py-2 text-xs first:pt-0 last:pb-0">
      <span className="font-medium text-neutral-900 dark:text-neutral-100">{app.dutyMember}</span>
      <span className="tabular-nums text-neutral-500 dark:text-neutral-400">{app.yearMonth}</span>
      <span className="text-neutral-400 dark:text-neutral-500" aria-hidden>
        ·
      </span>
      <span className="text-neutral-600 dark:text-neutral-300">{kind.shortLabel}</span>
      {showRestPanel ? (
        <label className="inline-flex items-center gap-0.5 text-neutral-600 dark:text-neutral-400">
          <span className="sr-only">休・✖ 加算</span>
          <span aria-hidden className="text-[10px]">
            休
          </span>
          <input
            type="number"
            min={0}
            max={MAX_APPROVED_EXTRA_REST_CROSS_MARKS}
            className={inputTiny}
            value={extraRestCross}
            onChange={(e) => setExtraRestCross(e.target.value)}
            title={`休・✖ 加算 0〜${MAX_APPROVED_EXTRA_REST_CROSS_MARKS}`}
          />
        </label>
      ) : null}
      {showNightPanel ? (
        <label className="inline-flex items-center gap-0.5 text-neutral-600 dark:text-neutral-400">
          <span className="sr-only">夜✖ 加算</span>
          <span aria-hidden className="text-[10px]">
            夜
          </span>
          <input
            type="number"
            min={0}
            max={MAX_APPROVED_EXTRA_NIGHT_MARKS}
            className={inputTiny}
            value={extraNight}
            onChange={(e) => setExtraNight(e.target.value)}
            title={`夜✖ 加算 0〜${MAX_APPROVED_EXTRA_NIGHT_MARKS}`}
          />
        </label>
      ) : null}
      <span className="ml-auto flex shrink-0 flex-wrap items-center gap-1">
        <button type="button" className={btnPrimary} onClick={approve}>
          承認
        </button>
        <button type="button" className={btnDanger} onClick={reject}>
          却下
        </button>
      </span>
      {error ? (
        <p className="w-full text-[11px] text-red-700 dark:text-red-300">{error}</p>
      ) : null}
    </li>
  );
}

/** 事前設定ダッシュボード先頭用：審査待ち申請の最小表示＋その場承認 */
export function PreferenceLimitPendingApprovalsStrip() {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const sync = () => setTick((t) => t + 1);
    window.addEventListener(PREFERENCE_APPLICATIONS_UPDATED_EVENT, sync);
    window.addEventListener("focus", sync);
    return () => {
      window.removeEventListener(PREFERENCE_APPLICATIONS_UPDATED_EVENT, sync);
      window.removeEventListener("focus", sync);
    };
  }, []);

  const pending = useMemo(() => {
    const all = listPreferenceApplicationsSorted(loadPreferenceApplicationsFromStorage());
    return all.filter((a) => a.status === "pending");
  }, [tick]);

  if (pending.length === 0) return null;

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50/90 px-3 py-2 shadow-sm dark:border-amber-800 dark:bg-amber-950/40">
      <p className="text-xs font-semibold text-amber-950 dark:text-amber-100">
        承認待ちの希望上限申請（{pending.length}）
      </p>
      <ul
        className={`mt-1 divide-y divide-amber-200/60 dark:divide-amber-900/50 ${
          pending.length > 4
            ? "max-h-[min(11rem,42vh)] overflow-y-auto overscroll-y-contain pr-0.5"
            : ""
        }`}
      >
        {pending.map((app) => (
          <CompactPendingRow key={app.id} app={app} onUpdated={() => setTick((t) => t + 1)} />
        ))}
      </ul>
    </div>
  );
}
