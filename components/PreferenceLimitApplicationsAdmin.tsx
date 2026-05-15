"use client";

import { useEffect, useMemo, useState } from "react";
import type { PreferenceLimitApplication } from "@/types";
import {
  DEFAULT_PREFERENCE_MONTHLY_CAPS,
  MAX_APPROVED_EXTRA_NIGHT_MARKS,
  MAX_APPROVED_EXTRA_REST_CROSS_MARKS,
} from "@/types";
import {
  listPreferenceApplicationsSorted,
  loadPreferenceApplicationsFromStorage,
  PREFERENCE_APPLICATIONS_UPDATED_EVENT,
  upsertPreferenceApplication,
} from "@/lib/preferenceApplicationsStorage";

const btnPrimary =
  "inline-flex items-center justify-center rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white";

const btnDanger =
  "inline-flex items-center justify-center rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-700 transition hover:bg-red-50 dark:border-red-900/60 dark:bg-neutral-900 dark:text-red-400 dark:hover:bg-red-950/40";

const inputClass =
  "mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm outline-none transition focus:border-neutral-500 focus:ring-2 focus:ring-neutral-400/30 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100";

function statusLabel(status: PreferenceLimitApplication["status"]): string {
  if (status === "pending") return "審査中";
  if (status === "approved") return "承認済み";
  return "却下";
}

function ApplicationReviewCard({
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

  function parseExtra(raw: string, max: number): number | null {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > max || !Number.isInteger(n)) return null;
    return n;
  }

  function approve() {
    const r = parseExtra(extraRestCross, MAX_APPROVED_EXTRA_REST_CROSS_MARKS);
    const n = parseExtra(extraNight, MAX_APPROVED_EXTRA_NIGHT_MARKS);
    if (r === null || n === null) {
      setError(
        `追加枠は 0〜${MAX_APPROVED_EXTRA_REST_CROSS_MARKS} の整数で入力してください。`,
      );
      return;
    }
    setError(null);
    upsertPreferenceApplication({
      ...app,
      status: "approved",
      approvedExtraRestCross: r,
      approvedExtraNight: n,
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

  const base = DEFAULT_PREFERENCE_MONTHLY_CAPS;
  const badge =
    app.status === "pending"
      ? "bg-amber-100 text-amber-950 dark:bg-amber-950/60 dark:text-amber-100"
      : app.status === "approved"
        ? "bg-emerald-100 text-emerald-950 dark:bg-emerald-950/50 dark:text-emerald-100"
        : "bg-red-100 text-red-950 dark:bg-red-950/50 dark:text-red-100";

  return (
    <li className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-semibold text-neutral-900 dark:text-neutral-100">
            {app.dutyMember} — {app.yearMonth}
          </p>
          <p className="text-xs text-neutral-500">
            申請: {new Date(app.submittedAt).toLocaleString("ja-JP")}
            {app.reviewedAt
              ? ` ／ 処理: ${new Date(app.reviewedAt).toLocaleString("ja-JP")}`
              : ""}
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${badge}`}>
          {statusLabel(app.status)}
        </span>
      </div>

      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-neutral-500">休・✖（申請時）</dt>
          <dd className="font-medium tabular-nums text-neutral-900 dark:text-neutral-100">
            {app.restCrossMarksAtSubmit} 件
          </dd>
        </div>
        <div>
          <dt className="text-neutral-500">夜✖（申請時）</dt>
          <dd className="font-medium tabular-nums text-neutral-900 dark:text-neutral-100">
            {app.nightMarksAtSubmit} 件
          </dd>
        </div>
      </dl>

      {app.restCrossReason ? (
        <p className="mt-3 rounded-lg bg-neutral-50 px-3 py-2 text-sm text-neutral-800 dark:bg-neutral-900 dark:text-neutral-200">
          <span className="font-medium">休・✖ の理由:</span> {app.restCrossReason}
        </p>
      ) : null}
      {app.nightReason ? (
        <p className="mt-2 rounded-lg bg-neutral-50 px-3 py-2 text-sm text-neutral-800 dark:bg-neutral-900 dark:text-neutral-200">
          <span className="font-medium">夜✖ の理由:</span> {app.nightReason}
        </p>
      ) : null}

      {app.status === "pending" ? (
        <div className="mt-4 space-y-4 border-t border-neutral-200 pt-4 dark:border-neutral-800">
          <p className="text-sm font-medium text-neutral-800 dark:text-neutral-200">
            部長承認（休・✖ と夜✖ は別々に加算）
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
                休・✖ の追加枠（0〜{MAX_APPROVED_EXTRA_REST_CROSS_MARKS}）
              </label>
              <p className="text-xs text-neutral-500">
                承認後の上限 = {base.maxBasePreferenceMarksPerMonth} + この数
              </p>
              <input
                type="number"
                min={0}
                max={MAX_APPROVED_EXTRA_REST_CROSS_MARKS}
                className={inputClass}
                value={extraRestCross}
                onChange={(e) => setExtraRestCross(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
                夜✖ の追加枠（0〜{MAX_APPROVED_EXTRA_NIGHT_MARKS}）
              </label>
              <p className="text-xs text-neutral-500">
                承認後の上限 = {base.maxNightUnavailableMarksPerMonth} + この数
              </p>
              <input
                type="number"
                min={0}
                max={MAX_APPROVED_EXTRA_NIGHT_MARKS}
                className={inputClass}
                value={extraNight}
                onChange={(e) => setExtraNight(e.target.value)}
              />
            </div>
          </div>
          {error ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnPrimary} onClick={approve}>
              承認する
            </button>
            <button type="button" className={btnDanger} onClick={reject}>
              却下する
            </button>
          </div>
        </div>
      ) : app.status === "approved" ? (
        <p className="mt-3 text-sm text-emerald-800 dark:text-emerald-300">
          承認: 休・✖ 上限 {base.maxBasePreferenceMarksPerMonth} + {app.approvedExtraRestCross}{" "}
          ／ 夜✖ 上限 {base.maxNightUnavailableMarksPerMonth} + {app.approvedExtraNight}
        </p>
      ) : (
        <p className="mt-3 text-sm text-red-800 dark:text-red-300">
          却下済み。部員に超過分のチェックを外すよう促してください。
        </p>
      )}
    </li>
  );
}

function ApplicationList({
  title,
  apps,
  onUpdated,
}: {
  title: string;
  apps: PreferenceLimitApplication[];
  onUpdated: () => void;
}) {
  if (apps.length === 0) return null;
  return (
    <div className={title === "審査待ち" ? "" : "mt-8"}>
      <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">{title}</h3>
      <ul className="mt-3 space-y-4">
        {apps.map((app) => (
          <ApplicationReviewCard
            key={app.id}
            app={app}
            onUpdated={onUpdated}
          />
        ))}
      </ul>
    </div>
  );
}

export function PreferenceLimitApplicationsAdmin() {
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

  const applications = useMemo(
    () => listPreferenceApplicationsSorted(loadPreferenceApplicationsFromStorage()),
    [tick],
  );

  const pending = applications.filter((a) => a.status === "pending");
  const others = applications.filter((a) => a.status !== "pending");

  return (
    <>
      {pending.length > 0 ? (
        <ApplicationList title="審査待ち" apps={pending} onUpdated={() => setTick((t) => t + 1)} />
      ) : (
        <p className="text-sm text-neutral-500">審査待ちの申請はありません。</p>
      )}
      <ApplicationList title="処理済み" apps={others} onUpdated={() => setTick((t) => t + 1)} />
    </>
  );
}
