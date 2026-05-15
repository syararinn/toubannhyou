"use client";

import { useState } from "react";
import type { DutyMember, PreferenceLimitApplication } from "@/types";
import { MAX_PREFERENCE_LIMIT_APPLICATIONS_PER_MONTH } from "@/types";
import {
  getEffectivePreferenceCaps,
  getPreferenceApplicationSubmitEligibility,
  needsPreferenceLimitApplication,
} from "@/lib/preferenceLimits";
import {
  newPreferenceApplicationId,
  upsertPreferenceApplication,
} from "@/lib/preferenceApplicationsStorage";

const btnPrimary =
  "inline-flex items-center justify-center rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white dark:disabled:opacity-40";

const textareaClass =
  "mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm outline-none transition focus:border-neutral-500 focus:ring-2 focus:ring-neutral-400/30 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100";

export function PreferenceLimitApplicationPanel({
  dutyMember,
  yearMonth,
  restCrossMarks,
  nightMarks,
  applications,
  onSubmitted,
}: {
  dutyMember: DutyMember;
  yearMonth: string;
  restCrossMarks: number;
  nightMarks: number;
  applications: PreferenceLimitApplication[];
  onSubmitted: () => void;
}) {
  const caps = getEffectivePreferenceCaps(applications);
  const need = needsPreferenceLimitApplication(restCrossMarks, nightMarks, caps);
  const submitEligibility = getPreferenceApplicationSubmitEligibility(applications);
  const pending = applications.find((a) => a.status === "pending");
  const lastRejected = [...applications].reverse().find((a) => a.status === "rejected");
  const approvedCount = applications.filter((a) => a.status === "approved").length;

  const [restCrossReason, setRestCrossReason] = useState("");
  const [nightReason, setNightReason] = useState("");
  const [requestRestCrossBump, setRequestRestCrossBump] = useState(false);
  const [requestNightBump, setRequestNightBump] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const canSubmit = submitEligibility.allowed;
  const showForm =
    !pending &&
    (need.restCross ||
      need.night ||
      requestRestCrossBump ||
      requestNightBump ||
      lastRejected !== undefined);

  function submitApplication() {
    const wantsRest =
      need.restCross || requestRestCrossBump || restCrossReason.trim().length > 0;
    const wantsNight = need.night || requestNightBump || nightReason.trim().length > 0;
    if (!wantsRest && !wantsNight) {
      setFormError("休・✖ または 夜✖ のいずれかについて申請してください。");
      return;
    }
    if (wantsRest && !restCrossReason.trim()) {
      setFormError("休・✖ について理由を入力してください。");
      return;
    }
    if (wantsNight && !nightReason.trim()) {
      setFormError("夜✖ について理由を入力してください。");
      return;
    }
    if (!canSubmit) {
      setFormError(submitEligibility.blockReason ?? "今月はこれ以上申請できません。");
      return;
    }
    setFormError(null);
    upsertPreferenceApplication({
      id: newPreferenceApplicationId(),
      dutyMember,
      yearMonth,
      status: "pending",
      submittedAt: new Date().toISOString(),
      restCrossReason: wantsRest ? restCrossReason.trim() : "",
      nightReason: wantsNight ? nightReason.trim() : "",
      restCrossMarksAtSubmit: restCrossMarks,
      nightMarksAtSubmit: nightMarks,
      approvedExtraRestCross: 0,
      approvedExtraNight: 0,
    });
    setRestCrossReason("");
    setNightReason("");
    setRequestRestCrossBump(false);
    setRequestNightBump(false);
    onSubmitted();
  }

  return (
    <div className="mt-3 space-y-3">
      <p className="text-xs text-neutral-500">
        今月の申請: {submitEligibility.usedCount} / {submitEligibility.maxCount} 回
        {approvedCount > 0 ? `（承認済み ${approvedCount} 件）` : ""}
      </p>

      {approvedCount > 0 && !pending ? (
        <p className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100">
          <strong>承認反映中（{yearMonth}）。</strong> 休・✖ 上限 {caps.restCross} 件、夜✖ 上限{" "}
          {caps.night} 件まで入力できます。
          {!need.restCross && !need.night && submitEligibility.allowed
            ? ` 追加の相談はあと ${submitEligibility.maxCount - submitEligibility.usedCount} 回申請できます。`
            : ""}
        </p>
      ) : null}

      {pending ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-100">
          <strong>審査中です（{pending.submittedAt.slice(0, 10)} 申請）。</strong>{" "}
          部長の承認まで、申請時点の件数（休・✖ {pending.restCrossMarksAtSubmit} ／ 夜✖{" "}
          {pending.nightMarksAtSubmit}）まで入力できます。
        </p>
      ) : null}

      {lastRejected && !pending ? (
        <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-950 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100">
          <strong>直近の申請は却下されました。</strong>{" "}
          超過している休・✖ または夜✖ のチェックを、ご自身で上限以内に減らしてから再申請してください。
        </p>
      ) : null}

      {(need.restCross || need.night) && !pending ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-100">
          現在の上限（休・✖ {caps.restCross} 件・夜✖ {caps.night} 件）を超えています。
          <strong>部長へ申請</strong>してください（月{" "}
          {MAX_PREFERENCE_LIMIT_APPLICATIONS_PER_MONTH} 回まで）。
        </p>
      ) : null}

      {!pending && !showForm && submitEligibility.allowed ? (
        <div className="rounded-lg border border-dashed border-neutral-300 px-3 py-3 dark:border-neutral-700">
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            育休などで事前に追加枠が必要な場合は、下のチェックで申請項目を表示できます（月{" "}
            {MAX_PREFERENCE_LIMIT_APPLICATIONS_PER_MONTH} 回まで）。
          </p>
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={requestRestCrossBump}
              onChange={(e) => setRequestRestCrossBump(e.target.checked)}
            />
            休・✖ の追加枠を申請する
          </label>
          <label className="mt-1 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={requestNightBump}
              onChange={(e) => setRequestNightBump(e.target.checked)}
            />
            夜✖ の追加枠を申請する
          </label>
        </div>
      ) : null}

      {showForm ? (
        <ApplicationForm
          need={need}
          requestRestCrossBump={requestRestCrossBump}
          requestNightBump={requestNightBump}
          setRequestRestCrossBump={setRequestRestCrossBump}
          setRequestNightBump={setRequestNightBump}
          restCrossReason={restCrossReason}
          setRestCrossReason={setRestCrossReason}
          nightReason={nightReason}
          setNightReason={setNightReason}
          formError={formError}
          canSubmit={canSubmit}
          blockReason={submitEligibility.blockReason}
          onSubmit={submitApplication}
        />
      ) : null}

      {!canSubmit && !pending && submitEligibility.blockReason ? (
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          {submitEligibility.blockReason}
        </p>
      ) : null}
    </div>
  );
}

function ApplicationForm({
  need,
  requestRestCrossBump,
  requestNightBump,
  setRequestRestCrossBump,
  setRequestNightBump,
  restCrossReason,
  setRestCrossReason,
  nightReason,
  setNightReason,
  formError,
  canSubmit,
  blockReason,
  onSubmit,
}: {
  need: { restCross: boolean; night: boolean };
  requestRestCrossBump: boolean;
  requestNightBump: boolean;
  setRequestRestCrossBump: (v: boolean) => void;
  setRequestNightBump: (v: boolean) => void;
  restCrossReason: string;
  setRestCrossReason: (v: string) => void;
  nightReason: string;
  setNightReason: (v: string) => void;
  formError: string | null;
  canSubmit: boolean;
  blockReason?: string;
  onSubmit: () => void;
}) {
  const showRest = need.restCross || requestRestCrossBump;
  const showNight = need.night || requestNightBump;

  return (
    <FormShell>
      {!need.restCross && (
        <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
          <input
            type="checkbox"
            checked={requestRestCrossBump}
            onChange={(e) => setRequestRestCrossBump(e.target.checked)}
          />
          休・✖ の追加枠を申請する（上限超過前の事前申請）
        </label>
      )}
      {!need.night && (
        <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
          <input
            type="checkbox"
            checked={requestNightBump}
            onChange={(e) => setRequestNightBump(e.target.checked)}
          />
          夜✖ の追加枠を申請する（上限超過前の事前申請）
        </label>
      )}
      {showRest ? (
        <div>
          <label className="block text-sm font-medium text-neutral-800 dark:text-neutral-200">
            休・✖ を超過する理由
          </label>
          <textarea
            className={textareaClass}
            rows={3}
            value={restCrossReason}
            onChange={(e) => setRestCrossReason(e.target.value)}
            placeholder="例: 追加で休みが必要になった"
          />
        </div>
      ) : null}
      {showNight ? (
        <div>
          <label className="block text-sm font-medium text-neutral-800 dark:text-neutral-200">
            夜✖ を超過する理由
          </label>
          <textarea
            className={textareaClass}
            rows={3}
            value={nightReason}
            onChange={(e) => setNightReason(e.target.value)}
            placeholder="例: 通院のため夜勤不可が続く"
          />
        </div>
      ) : null}
      {formError ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
          {formError}
        </p>
      ) : null}
      <button type="button" className={btnPrimary} disabled={!canSubmit} onClick={onSubmit}>
        部長へ申請する
      </button>
      {!canSubmit && blockReason ? (
        <p className="text-xs text-neutral-500">{blockReason}</p>
      ) : null}
    </FormShell>
  );
}

function FormShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-3 rounded-xl border border-neutral-200 bg-neutral-50/80 p-4 dark:border-neutral-800 dark:bg-neutral-900/40">
      {children}
    </div>
  );
}
