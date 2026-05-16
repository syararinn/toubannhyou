"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AdminSettings,
  DutyMember,
  ISODateString,
  MemberDayPreferenceFlags,
  MemberPreferenceInput,
} from "@/types";
import {
  DEFAULT_PREFERENCE_MONTHLY_CAPS,
  ROSTER_COLUMN_ORDER,
} from "@/types";
import { PreferenceLimitApplicationPanel } from "@/components/PreferenceLimitApplicationPanel";
import {
  ADMIN_SETTINGS_UPDATED_EVENT,
  loadAdminSettingsFromStorage,
} from "@/lib/adminSettingsStorage";
import {
  loadMemberPreferencesFromStorage,
  saveMemberPreferencesToStorage,
} from "@/lib/memberPreferencesStorage";
import {
  listApplicationsForMemberMonth,
  loadPreferenceApplicationsFromStorage,
  PREFERENCE_APPLICATIONS_UPDATED_EVENT,
} from "@/lib/preferenceApplicationsStorage";
import {
  countHalfDayMarks,
  countNightMarks,
  countRestCrossMarks,
  emptyPreferenceFlags,
  getEffectivePreferenceCaps,
  isPreferenceToggleDisabled,
  preferenceToggleBlockedBySameDayConflict,
  sanitizeSameDayPreferenceFlags,
  wouldExceedPreferenceCap,
  yearMonthFromParts,
  type PreferenceToggleKey,
} from "@/lib/preferenceLimits";
import { getMemberCongressDutyLabels } from "@/lib/roster/congress-member-notice";
import { DEFAULT_HALF_DAY_MARKS_PER_MONTH } from "@/types";

const DUTY_MEMBERS = ROSTER_COLUMN_ORDER.filter(
  (name): name is DutyMember => name !== "牛田" && name !== "倉科",
);

const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"] as const;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function toISODate(y: number, m0: number, d: number): ISODateString {
  return `${y}-${pad2(m0 + 1)}-${pad2(d)}`;
}

function listDatesInMonth(year: number, month0: number): ISODateString[] {
  const last = new Date(year, month0 + 1, 0).getDate();
  const out: ISODateString[] = [];
  for (let d = 1; d <= last; d++) {
    out.push(toISODate(year, month0, d));
  }
  return out;
}

/** 他部員の「休・✖」希望件数のモック（日付に依存する固定乱数）。API 接続時はサーバ集計に差し替え */
function mockOtherMembersHardOffCount(date: ISODateString): number {
  let h = 0;
  const s = `${date}|peer-mock-v1`;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 7;
}

/**
 * 平日は早番・遅番で最低 2 名が必要なため、
 * 「休・✖」希望が多すぎる日は配置不能に近いとみなして警告する。
 */
function isHighCongestionRisk(
  date: ISODateString,
  flags: MemberDayPreferenceFlags,
): boolean {
  const userHard = flags.fullDayOff || flags.fullyUnavailable ? 1 : 0;
  const peers = mockOtherMembersHardOffCount(date);
  return peers + userHard >= 6;
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-950">
      <h2 className="text-lg font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
        {title}
      </h2>
      {description ? (
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          {description}
        </p>
      ) : null}
      <div className="mt-5 space-y-4">{children}</div>
    </section>
  );
}

const btnPrimary =
  "inline-flex items-center justify-center rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white";

const btnSecondary =
  "inline-flex items-center justify-center rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-800 shadow-sm transition hover:bg-neutral-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800";

const AI_RULES_PUBLIC_TEXT = [
  "勤務の前後に十分なインターバルが確保されるよう配慮します。",
  "毎週（月曜始まり）、当番の回数が可能な限り均等になるよう調整します（国会当番・グラフ専任・出向者は対象外）。",
  "AIとして要件定義に基づき極限まで均等化を目指し計算し直します。",
  "ご入力いただいた希望は可能な範囲で尊重しますが、全体の制約を満たす必要があるため、すべてが通るとは限りません。",
  "「休」「✖️」はその日の当番を希望しないものです。「夜✖️」は遅番と休日の出勤（土日祝のメイン枠）を希望しないものです。早番は可で、休日の予備は原則避けますが、どうしても人手が足りないときのみ割り当て得ます。",
  "原則として、遅番の翌日は早番には入りません。他に配置できる人がいない場合のみ早番になることがあります。",
  "日曜・祝日にメイン出勤した方の翌日は、原則として早番には入りません。他に配置できる人がいない場合のみ早番になることがあります。",
  "土曜・日曜・祝日の出勤は、原則として休日の連続出勤にはしません。他に配置できる人がいない場合のみ、休日が続いても出勤になることがあります。",
  "早番・遅番は、原則として前日と同じ方に続けてつけません。他に配置できる人がいない場合のみ、連続になることがあります。",
  "国会会期・休刊作業日・グラフ専任・出向など、管理者が登録した条件は必ず守られます。",
  "最終的な割当はシステムが複数の条件を総合して決定します。",
] as const;

export default function MemberInputPage() {
  const now = useMemo(() => new Date(), []);
  const [year, setYear] = useState(now.getFullYear());
  const [month0, setMonth0] = useState(now.getMonth());

  const [selectedMember, setSelectedMember] = useState<DutyMember | null>(null);
  const [prefsByMember, setPrefsByMember] = useState<
    Record<DutyMember, Record<ISODateString, MemberDayPreferenceFlags>>
  >(() => loadMemberPreferencesFromStorage());

  const [applicationsTick, setApplicationsTick] = useState(0);
  const [capBlockMessage, setCapBlockMessage] = useState<string | null>(null);

  const [rulesOpen, setRulesOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "calendar">("list");

  const [adminSnapshot, setAdminSnapshot] = useState<AdminSettings>(() =>
    loadAdminSettingsFromStorage(),
  );

  useEffect(() => {
    const sync = () => setAdminSnapshot(loadAdminSettingsFromStorage());
    sync();
    window.addEventListener(ADMIN_SETTINGS_UPDATED_EVENT, sync);
    window.addEventListener("focus", sync);
    return () => {
      window.removeEventListener(ADMIN_SETTINGS_UPDATED_EVENT, sync);
      window.removeEventListener("focus", sync);
    };
  }, []);

  useEffect(() => {
    saveMemberPreferencesToStorage(prefsByMember);
  }, [prefsByMember]);

  useEffect(() => {
    const sync = () => setApplicationsTick((t) => t + 1);
    window.addEventListener(PREFERENCE_APPLICATIONS_UPDATED_EVENT, sync);
    window.addEventListener("focus", sync);
    return () => {
      window.removeEventListener(PREFERENCE_APPLICATIONS_UPDATED_EVENT, sync);
      window.removeEventListener("focus", sync);
    };
  }, []);

  const yearMonth = yearMonthFromParts(year, month0);

  const flagsByDate = selectedMember ? prefsByMember[selectedMember] : {};
  const restCrossMarks = useMemo(
    () => countRestCrossMarks(flagsByDate, year, month0),
    [flagsByDate, year, month0],
  );
  const halfDayMarks = useMemo(
    () => countHalfDayMarks(flagsByDate, year, month0),
    [flagsByDate, year, month0],
  );
  const nightMarks = useMemo(
    () => countNightMarks(flagsByDate, year, month0),
    [flagsByDate, year, month0],
  );

  const monthApplications = useMemo(() => {
    if (!selectedMember) return [];
    void applicationsTick;
    return listApplicationsForMemberMonth(
      loadPreferenceApplicationsFromStorage(),
      selectedMember,
      yearMonth,
    );
  }, [selectedMember, yearMonth, applicationsTick]);

  const approvedExtraRestCross = useMemo(
    () =>
      monthApplications
        .filter((a) => a.status === "approved")
        .reduce((s, a) => s + a.approvedExtraRestCross, 0),
    [monthApplications],
  );
  const approvedExtraNight = useMemo(
    () =>
      monthApplications
        .filter((a) => a.status === "approved")
        .reduce((s, a) => s + a.approvedExtraNight, 0),
    [monthApplications],
  );

  const effectiveCaps = useMemo(
    () => getEffectivePreferenceCaps(monthApplications),
    [monthApplications],
  );

  const halfDayOver = halfDayMarks > effectiveCaps.halfDay;

  const monthDates = useMemo(() => listDatesInMonth(year, month0), [year, month0]);

  const leadingBlanks = useMemo(() => {
    const first = new Date(year, month0, 1).getDay();
    return first;
  }, [year, month0]);

  const snapshot: MemberPreferenceInput | null = useMemo(() => {
    if (!selectedMember) return null;
    const entries = Object.entries(prefsByMember[selectedMember])
      .filter(([, f]) =>
        Object.values(f).some(Boolean),
      )
      .map(([date, flags]) => ({ date: date as ISODateString, flags }))
      .sort((a, b) => a.date.localeCompare(b.date));
    return { dutyMember: selectedMember, entries };
  }, [selectedMember, prefsByMember]);

  const setFlag = useCallback(
    (date: ISODateString, patch: Partial<MemberDayPreferenceFlags>) => {
      if (!selectedMember) return;
      setPrefsByMember((prev) => {
        const memberMap = { ...prev[selectedMember] };
        const cur = { ...(memberMap[date] ?? emptyPreferenceFlags()), ...patch };
        if (
          !cur.fullDayOff &&
          !cur.fullyUnavailable &&
          !cur.morningHalfOff &&
          !cur.afternoonHalfOff &&
          !cur.nightUnavailable
        ) {
          delete memberMap[date];
        } else {
          memberMap[date] = cur;
        }
        return { ...prev, [selectedMember]: memberMap };
      });
    },
    [selectedMember],
  );

  function applyExclusiveRules(
    date: ISODateString,
    next: MemberDayPreferenceFlags,
  ): MemberDayPreferenceFlags {
    let f = { ...next };
    if (f.fullDayOff) {
      f = {
        ...f,
        fullyUnavailable: false,
        morningHalfOff: false,
        afternoonHalfOff: false,
        nightUnavailable: false,
      };
    }
    if (f.fullyUnavailable) {
      f = {
        ...f,
        fullDayOff: false,
        morningHalfOff: false,
        afternoonHalfOff: false,
        nightUnavailable: false,
      };
    }
    if (f.morningHalfOff || f.afternoonHalfOff) {
      f = { ...f, fullDayOff: false, fullyUnavailable: false };
    }
    return sanitizeSameDayPreferenceFlags(f);
  }

  function toggleFlag(date: ISODateString, key: PreferenceToggleKey, checked: boolean) {
    setCapBlockMessage(null);
    const existing = flagsByDate[date] ?? emptyPreferenceFlags();
    const sameDayBlock = preferenceToggleBlockedBySameDayConflict(existing, key, checked);
    if (sameDayBlock) {
      setCapBlockMessage(sameDayBlock);
      return;
    }
    const cur = { ...existing, [key]: checked };
    const merged = applyExclusiveRules(date, cur);
    if (checked && wouldExceedPreferenceCap(key, flagsByDate, year, month0, date, merged, effectiveCaps)) {
      if (key === "fullDayOff" || key === "fullyUnavailable") {
        setCapBlockMessage(
          `休・✖ は ${effectiveCaps.restCross} 件までです。超える場合は部長へ申請し、承認後に入力してください。`,
        );
      } else if (key === "morningHalfOff" || key === "afternoonHalfOff") {
        setCapBlockMessage(
          `午前・午後半休は ${effectiveCaps.halfDay} 件までです（申請の対象外）。`,
        );
      } else {
        setCapBlockMessage(
          `夜✖ は ${effectiveCaps.night} 件までです。超える場合は部長へ申請し、承認後に入力してください。`,
        );
      }
      return;
    }
    setFlag(date, merged);
  }

  function monthTitle(): string {
    return `${year}年${month0 + 1}月`;
  }

  function shiftMonth(delta: number) {
    const d = new Date(year, month0 + delta, 1);
    setYear(d.getFullYear());
    setMonth0(d.getMonth());
  }

  function summaryDots(f: MemberDayPreferenceFlags | undefined): string {
    if (!f) return "";
    const parts: string[] = [];
    if (f.fullDayOff) parts.push("休");
    if (f.fullyUnavailable) parts.push("✖");
    if (f.morningHalfOff) parts.push("前");
    if (f.afternoonHalfOff) parts.push("後");
    if (f.nightUnavailable) parts.push("夜");
    return parts.join("·");
  }

  return (
    <div className="min-h-screen bg-neutral-50 pb-16 dark:bg-neutral-950">
      <header className="border-b border-neutral-200 bg-white/80 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/80">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 px-4 py-8 sm:px-6">
          <p className="text-xs font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
            部員向け
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-50">
                シフト希望の入力
              </h1>
              <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                ご自身の氏名を選び、対象月の各日に希望を入力してください（現在はブラウザ内のみに保存されるモックです）。
                国会当番（月／週）は、同一ブラウザで{" "}
                <a href="/admin" className="font-medium text-neutral-900 underline dark:text-neutral-100">
                  管理者設定
                </a>{" "}
                に登録された内容があれば、平日の行に表示されます。
              </p>
            </div>
            <button type="button" className={btnSecondary} onClick={() => setRulesOpen(true)}>
              AIによる生成ルールを見る
            </button>
          </div>
          <aside className="rounded-xl border border-amber-200/80 bg-amber-50/90 px-4 py-3 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100">
            <p className="font-medium">仕様の透明化</p>
            <p className="mt-1 text-amber-900/90 dark:text-amber-200/90">
              当番表は、勤務間インターバルや公平な配分など、公開している基本方針に沿って自動生成されます。詳しくは右上の「AIによる生成ルールを見る」を開いてください。
            </p>
          </aside>
        </div>
      </header>

      <main className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-10 sm:px-6">
        <Section
          title="部員を選択"
          description="7 名の部員のうち、入力するご自身を選んでください。"
        >
          <div className="flex flex-wrap gap-2">
            {DUTY_MEMBERS.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => setSelectedMember(name)}
                className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                  selectedMember === name
                    ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900"
                    : "border-neutral-300 bg-white text-neutral-800 hover:border-neutral-400 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:border-neutral-500"
                }`}
              >
                {name}
              </button>
            ))}
          </div>
          {!selectedMember ? (
            <p className="text-sm text-neutral-500">氏名を選ぶと、下の入力欄が有効になります。</p>
          ) : null}
        </Section>

        {selectedMember ? (
          <>
            <Section
              title={`希望入力（${monthTitle()}・${selectedMember}）`}
              description="各日について「休」「✖️」「午前半休」「午後半休」「夜✖️」から該当するものにチェックを入れます。休・✖️は他の全日系・半休と同時には選べません。同日に午前半休と午後半休、または午前半休と夜✖を両方選ぶことはできません。夜✖は遅番と休日の出勤（土日祝のメイン枠）には入りませんが、早番には入る場合があります。平日で国会当番に指定されている日は行の色と「注意」欄でお知らせします。"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <button type="button" className={btnSecondary} onClick={() => shiftMonth(-1)}>
                    前月
                  </button>
                  <span className="min-w-[8rem] text-center text-sm font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
                    {monthTitle()}
                  </span>
                  <button type="button" className={btnSecondary} onClick={() => shiftMonth(1)}>
                    翌月
                  </button>
                </div>
                <div className="inline-flex rounded-lg border border-neutral-200 p-0.5 dark:border-neutral-700">
                  <button
                    type="button"
                    className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                      viewMode === "list"
                        ? "bg-neutral-900 text-white shadow dark:bg-neutral-100 dark:text-neutral-900"
                        : "text-neutral-600 dark:text-neutral-400"
                    }`}
                    onClick={() => setViewMode("list")}
                  >
                    リスト
                  </button>
                  <button
                    type="button"
                    className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                      viewMode === "calendar"
                        ? "bg-neutral-900 text-white shadow dark:bg-neutral-100 dark:text-neutral-900"
                        : "text-neutral-600 dark:text-neutral-400"
                    }`}
                    onClick={() => setViewMode("calendar")}
                  >
                    カレンダー
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
                <div className="flex flex-wrap gap-4 text-sm">
                  <p className="text-neutral-700 dark:text-neutral-300">
                    休・✖:{" "}
                    <span className="font-semibold tabular-nums">{restCrossMarks}</span> /{" "}
                    {effectiveCaps.restCross}
                    {approvedExtraRestCross > 0 ? `（+${approvedExtraRestCross} 承認）` : ""}
                  </p>
                  <p className="text-neutral-700 dark:text-neutral-300">
                    午前・午後半休:{" "}
                    <span className="font-semibold tabular-nums">{halfDayMarks}</span> /{" "}
                    {DEFAULT_HALF_DAY_MARKS_PER_MONTH}
                  </p>
                  <p className="text-neutral-700 dark:text-neutral-300">
                    夜✖️:{" "}
                    <span className="font-semibold tabular-nums">{nightMarks}</span> /{" "}
                    {effectiveCaps.night}
                    {approvedExtraNight > 0 ? `（+${approvedExtraNight} 承認）` : ""}
                  </p>
                </div>
                {capBlockMessage ? (
                  <p className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-950 dark:border-red-800 dark:bg-red-950/50 dark:text-red-100">
                    {capBlockMessage}
                  </p>
                ) : null}
                {halfDayOver ? (
                  <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-100">
                    午前・午後半休は月 {DEFAULT_HALF_DAY_MARKS_PER_MONTH} 件までです。超過分はチェックを外してください。
                  </p>
                ) : null}
                {selectedMember ? (
                  <PreferenceLimitApplicationPanel
                    dutyMember={selectedMember}
                    yearMonth={yearMonth}
                    restCrossMarks={restCrossMarks}
                    nightMarks={nightMarks}
                    applications={monthApplications}
                    onSubmitted={() => setApplicationsTick((t) => t + 1)}
                  />
                ) : null}
              </div>

              {viewMode === "calendar" ? (
                <div className="overflow-x-auto">
                  <div className="grid min-w-[280px] grid-cols-7 gap-1 text-center text-xs font-medium text-neutral-500 dark:text-neutral-400">
                    {WEEKDAY_JA.map((w) => (
                      <div key={w} className="py-2">
                        {w}
                      </div>
                    ))}
                  </div>
                  <div className="grid min-w-[280px] grid-cols-7 gap-1">
                    {Array.from({ length: leadingBlanks }).map((_, i) => (
                      <div key={`blank-${i}`} className="aspect-square" />
                    ))}
                    {monthDates.map((date) => {
                      const d = Number(date.slice(8, 10));
                      const f = flagsByDate[date];
                      const congested = isHighCongestionRisk(date, f ?? emptyPreferenceFlags());
                      const dots = summaryDots(f);
                      const congressLabels =
                        selectedMember !== null
                          ? getMemberCongressDutyLabels(adminSnapshot, date, selectedMember)
                          : [];
                      const congressDay = congressLabels.length > 0;
                      return (
                        <div
                          key={date}
                          title={date}
                          className={`flex aspect-square flex-col items-center justify-center rounded-lg border text-xs transition ${
                            congressDay
                              ? "border-amber-400 bg-amber-100/90 dark:border-amber-700 dark:bg-amber-950/50"
                              : congested
                                ? "border-red-300 bg-red-50/80 dark:border-red-900/60 dark:bg-red-950/30"
                                : "border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900/60"
                          }`}
                        >
                          <span className="font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
                            {d}
                          </span>
                          {congressDay ? (
                            <span className="mt-0.5 max-w-full truncate px-0.5 text-[9px] font-medium text-amber-900 dark:text-amber-200">
                              国会
                            </span>
                          ) : null}
                          {dots ? (
                            <span className="mt-0.5 max-w-full truncate px-0.5 text-[10px] text-neutral-600 dark:text-neutral-400">
                              {dots}
                            </span>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-500">
                    カレンダーは月間の俯瞰用です。チェックの入出力はリスト表示で行ってください。
                  </p>
                </div>
              ) : null}

              {viewMode === "list" ? (
                <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
                  <table className="min-w-[720px] w-full border-collapse text-left text-sm">
                    <thead>
                      <tr className="border-b border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900/50">
                        <th className="whitespace-nowrap px-3 py-2 font-medium text-neutral-700 dark:text-neutral-300">
                          日付
                        </th>
                        <th className="whitespace-nowrap px-2 py-2 font-medium text-neutral-700 dark:text-neutral-300">
                          曜
                        </th>
                        <th className="px-2 py-2 text-center font-medium text-neutral-700 dark:text-neutral-300">
                          休
                        </th>
                        <th className="px-2 py-2 text-center font-medium text-neutral-700 dark:text-neutral-300">
                          ✖️
                        </th>
                        <th className="px-2 py-2 text-center font-medium text-neutral-700 dark:text-neutral-300">
                          午前半休
                        </th>
                        <th className="px-2 py-2 text-center font-medium text-neutral-700 dark:text-neutral-300">
                          午後半休
                        </th>
                        <th className="px-2 py-2 text-center font-medium text-neutral-700 dark:text-neutral-300">
                          夜✖️
                        </th>
                        <th className="min-w-[10rem] px-3 py-2 font-medium text-neutral-700 dark:text-neutral-300">
                          注意
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthDates.map((date) => {
                        const f = flagsByDate[date] ?? emptyPreferenceFlags();
                        const wd = new Date(date + "T12:00:00").getDay();
                        const congested = isHighCongestionRisk(date, f);
                        const congressLabels = getMemberCongressDutyLabels(
                          adminSnapshot,
                          date,
                          selectedMember!,
                        );
                        const congressDay = congressLabels.length > 0;
                        return (
                          <tr
                            key={date}
                            className={`border-b border-neutral-100 odd:bg-white even:bg-neutral-50/80 dark:border-neutral-800/80 dark:odd:bg-neutral-950 dark:even:bg-neutral-900/40 ${
                              congressDay
                                ? "border-l-4 border-l-amber-500 bg-amber-50/70 dark:bg-amber-950/25"
                                : ""
                            }`}
                          >
                            <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-neutral-800 dark:text-neutral-200">
                              {date}
                            </td>
                            <td className="whitespace-nowrap px-2 py-2 text-neutral-600 dark:text-neutral-400">
                              {WEEKDAY_JA[wd]}
                            </td>
                            {(
                              [
                                ["fullDayOff", f.fullDayOff],
                                ["fullyUnavailable", f.fullyUnavailable],
                                ["morningHalfOff", f.morningHalfOff],
                                ["afternoonHalfOff", f.afternoonHalfOff],
                                ["nightUnavailable", f.nightUnavailable],
                              ] as const
                            ).map(([key, checked]) => {
                              const disabled = isPreferenceToggleDisabled(f, key);
                              return (
                              <td key={key} className="px-2 py-2 text-center align-middle">
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 rounded border-neutral-300 disabled:cursor-not-allowed disabled:opacity-40 dark:border-neutral-600"
                                  checked={checked}
                                  disabled={disabled}
                                  title={
                                    disabled
                                      ? key === "morningHalfOff"
                                        ? "午後半休または夜✖が付いているため選べません"
                                        : "午前半休が付いているため選べません"
                                      : undefined
                                  }
                                  onChange={(e) =>
                                    toggleFlag(date, key, e.target.checked)
                                  }
                                />
                              </td>
                            );
                            })}
                            <td className="px-3 py-2 text-xs">
                              <div className="flex flex-col gap-1.5">
                                {congressLabels.map((line) => (
                                  <div
                                    key={line}
                                    className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
                                  >
                                    {line}
                                  </div>
                                ))}
                                {congested ? (
                                  <span className="text-red-700 dark:text-red-400">
                                    この日は休・✖️希望が集中しやすく、配置が成立しづらい可能性があります。
                                  </span>
                                ) : null}
                                {!congressLabels.length && !congested ? (
                                  <span className="text-neutral-400">—</span>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </Section>

            <Section
              title="保持中の希望データ（確認用）"
              description="選択中の部員について、型 MemberPreferenceInput 相当の JSON です。"
            >
              <pre className="max-h-72 overflow-auto rounded-xl bg-neutral-900 p-4 text-xs leading-relaxed text-neutral-100">
                {JSON.stringify(snapshot, null, 2)}
              </pre>
            </Section>
          </>
        ) : null}
      </main>

      {rulesOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="rules-title"
          onClick={() => setRulesOpen(false)}
        >
          <div
            className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-neutral-200 bg-white p-6 shadow-xl dark:border-neutral-700 dark:bg-neutral-950"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <h2
                id="rules-title"
                className="text-lg font-semibold text-neutral-900 dark:text-neutral-50"
              >
                AI による当番表生成の基本方針
              </h2>
              <button
                type="button"
                className="rounded-lg px-2 py-1 text-sm text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                onClick={() => setRulesOpen(false)}
                aria-label="閉じる"
              >
                ✕
              </button>
            </div>
            <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
              部員の皆さまに公開しているルールの要約です。細部の調整処理はシステム内部で行われます。
            </p>
            <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-neutral-800 dark:text-neutral-200">
              {AI_RULES_PUBLIC_TEXT.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <div className="mt-6 flex justify-end">
              <button type="button" className={btnPrimary} onClick={() => setRulesOpen(false)}>
                閉じる
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
