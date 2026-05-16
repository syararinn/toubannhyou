"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { GeneratedRosterDay, ISODateString, RosterColumnPerson } from "@/types";
import { ROSTER_COLUMN_ORDER } from "@/types";
import {
  ADMIN_SETTINGS_UPDATED_EVENT,
  loadAdminSettingsFromStorage,
} from "@/lib/adminSettingsStorage";
import {
  computeRosterRangeFromSavedData,
  countStoredPreferenceDays,
  loadMemberPreferencesFromStorage,
  memberPreferencesStoreToGenerateInput,
  MEMBER_PREFERENCES_UPDATED_EVENT,
} from "@/lib/memberPreferencesStorage";
import { csvWithUtf8Bom, rosterDaysToCsv } from "@/lib/roster/csv";
import { DEMO_ROSTER_RANGE, demoAdminSettings, demoPreferencesByMember } from "@/lib/roster/demo";
import { compareIso } from "@/lib/roster/dates";
import { generateRoster, type UnfilledSlot } from "@/lib/roster/generate";
import { formatRosterDutyCellText } from "@/lib/roster/roster-cell-display";

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function calendarMonthRange(year: number, month0: number): {
  start: ISODateString;
  end: ISODateString;
} {
  const last = new Date(year, month0 + 1, 0).getDate();
  return {
    start: `${year}-${pad2(month0 + 1)}-01`,
    end: `${year}-${pad2(month0 + 1)}-${pad2(last)}`,
  };
}

function defaultGenerateRange(): { start: ISODateString; end: ISODateString } {
  const now = new Date();
  const fromSaved = calendarMonthRange(now.getFullYear(), now.getMonth());
  return fromSaved;
}

function validateGenerateRange(
  start: string,
  end: string,
): string | null {
  if (!start || !end) return "生成期間の開始日と終了日を指定してください。";
  if (compareIso(start, end) > 0) {
    return "開始日は終了日以前にしてください。";
  }
  return null;
}

const ROSTER_TABLE_COLSPAN =
  2 + ROSTER_COLUMN_ORDER.length;

function yearMonthKey(iso: ISODateString): string {
  return iso.slice(0, 7);
}

/** 例: 2026-05 → 2026年5月 */
function formatJapaneseYearMonth(ym: string): string {
  const [y, m] = ym.split("-").map((s) => parseInt(s, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m)) return ym;
  return `${y}年${m}月`;
}

/** ISO 日付から「日」欄用（月は別行で表示するため日のみ） */
function dayOfMonthLabel(iso: ISODateString): string {
  const d = parseInt(iso.slice(8, 10), 10);
  return Number.isFinite(d) ? String(d) : iso.slice(8);
}

type RosterTableBodyItem =
  | { kind: "spacer"; key: string }
  | { kind: "month-banner"; key: string; yearMonth: string }
  | { kind: "day"; key: string; row: GeneratedRosterDay };

/** 月が変わるたびにスペーサー＋年月行を差し込み、日付は日単位のみの行で続ける */
function buildRosterTableBodyItems(days: GeneratedRosterDay[]): RosterTableBodyItem[] {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const out: RosterTableBodyItem[] = [];
  let prevYm: string | null = null;
  for (const row of sorted) {
    const ym = yearMonthKey(row.date);
    if (ym !== prevYm) {
      if (prevYm !== null) {
        out.push({ kind: "spacer", key: `spacer-${ym}-1` });
        out.push({ kind: "spacer", key: `spacer-${ym}-2` });
      }
      out.push({ kind: "month-banner", key: `month-${ym}`, yearMonth: ym });
      prevYm = ym;
    }
    out.push({ kind: "day", key: row.date, row });
  }
  return out;
}

const inputDateClass =
  "rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-mono tabular-nums text-neutral-900 shadow-sm focus:border-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-500 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100";

const btnPrimary =
  "inline-flex items-center justify-center rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white";

const btnSecondary =
  "inline-flex items-center justify-center rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-800 shadow-sm transition hover:bg-neutral-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800";

function isSaturdayRow(row: GeneratedRosterDay): boolean {
  return row.weekdayLabel === "土";
}

/** 日曜・祝日・振替休日など（土曜は除く。土曜は常に別色） */
function isPastelPinkRestDayRow(row: GeneratedRosterDay): boolean {
  if (row.isRestDayPastelPinkRow !== undefined) return row.isRestDayPastelPinkRow;
  if (row.weekdayLabel === "土") return false;
  return row.weekdayLabel === "日" || Boolean(row.nationalHolidayColumnText?.trim());
}

/** 日曜・祝日行は薄いピンク、土曜は薄いグリーン（土曜を優先） */
function rowBackgroundClass(row: GeneratedRosterDay): string {
  if (isSaturdayRow(row)) {
    return "border-b border-neutral-100 bg-green-50/95 dark:border-neutral-800/80 dark:bg-green-950/35";
  }
  if (isPastelPinkRestDayRow(row)) {
    return "border-b border-neutral-100 bg-pink-50/95 dark:border-neutral-800/80 dark:bg-pink-950/35";
  }
  return "border-b border-neutral-100 odd:bg-white even:bg-neutral-50/80 dark:border-neutral-800/80 dark:odd:bg-neutral-950 dark:even:bg-neutral-900/40";
}

function stickyCellBgClass(row: GeneratedRosterDay): string {
  if (isSaturdayRow(row)) {
    return "bg-green-50/95 dark:bg-green-950/35";
  }
  if (isPastelPinkRestDayRow(row)) {
    return "bg-pink-50/95 dark:bg-pink-950/35";
  }
  return "bg-inherit";
}

/** 行事列用：行事予定と祭日（A列では省略）をまとめて表示。重複は1つに。 */
function rosterCombinedEventsText(row: GeneratedRosterDay): string {
  const ev = row.eventsAndNotes?.trim() ?? "";
  const hol = row.nationalHolidayColumnText?.trim() ?? "";
  if (!ev) return hol;
  if (!hol) return ev;
  if (ev === hol || ev.includes(hol)) return ev;
  if (hol.includes(ev)) return hol;
  return `${ev}\n${hol}`;
}

/** 早番＝濃い青、遅番＝赤 */
function formatDutyCellText(raw: string, row: GeneratedRosterDay): ReactNode {
  if (!raw) return "";
  const parts = formatRosterDutyCellText(raw, row).split("・");
  return parts.map((segment, i) => {
    const display = segment;
    let segClass = "";
    if (segment === "早番") {
      segClass = "font-semibold text-blue-900 dark:text-blue-300";
    } else if (segment === "遅番") {
      segClass = "font-semibold text-red-600 dark:text-red-400";
    } else if (segment === "国会（応援）") {
      segClass = "font-medium text-violet-800 dark:text-violet-300";
    } else if (
      segment === "国会当番" ||
      segment === "国会月番" ||
      segment === "国会週番"
    ) {
      segClass = "font-medium text-neutral-800 dark:text-neutral-200";
    } else if (segment === "グラフ") {
      segClass = "font-medium text-teal-800 dark:text-teal-300";
    }
    return (
      <Fragment key={`${segment}-${i}`}>
        {i > 0 ? <span className="text-neutral-400">・</span> : null}
        <span className={segClass || undefined}>{display}</span>
      </Fragment>
    );
  });
}

function DutyAndPreferenceCell({
  name,
  row,
}: {
  name: RosterColumnPerson;
  row: GeneratedRosterDay;
}) {
  const dutyRaw = row.rosterCellsByColumnPerson[name] || "";
  const marks =
    row.preferenceMarksByColumnPerson?.[name]?.trim() ||
    "";
  return (
    <div className="flex min-h-[2.5rem] flex-col items-center justify-center gap-0 px-0.5 py-0 text-center leading-tight">
      <div className="whitespace-pre-wrap break-words text-center text-[11px] leading-snug sm:text-xs">
        {formatDutyCellText(dutyRaw, row)}
      </div>
      {marks ? (
        <div className="max-w-[6.5rem] text-center text-[9px] leading-tight text-neutral-500 dark:text-neutral-400">
          {marks}
        </div>
      ) : null}
    </div>
  );
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

export default function ResultPage() {
  const [days, setDays] = useState<GeneratedRosterDay[] | null>(null);
  const [unfilled, setUnfilled] = useState<UnfilledSlot[] | null>(null);
  const [generatedRange, setGeneratedRange] = useState<{
    start: ISODateString;
    end: ISODateString;
  } | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [prefsSnapshot, setPrefsSnapshot] = useState(() =>
    loadMemberPreferencesFromStorage(),
  );
  const [storageTick, setStorageTick] = useState(0);
  const [rangeStart, setRangeStart] = useState<ISODateString>(() =>
    defaultGenerateRange().start,
  );
  const [rangeEnd, setRangeEnd] = useState<ISODateString>(() =>
    defaultGenerateRange().end,
  );

  useEffect(() => {
    const sync = () => {
      setPrefsSnapshot(loadMemberPreferencesFromStorage());
      setStorageTick((t) => t + 1);
    };
    sync();
    window.addEventListener(MEMBER_PREFERENCES_UPDATED_EVENT, sync);
    window.addEventListener(ADMIN_SETTINGS_UPDATED_EVENT, sync);
    window.addEventListener("focus", sync);
    return () => {
      window.removeEventListener(MEMBER_PREFERENCES_UPDATED_EVENT, sync);
      window.removeEventListener(ADMIN_SETTINGS_UPDATED_EVENT, sync);
      window.removeEventListener("focus", sync);
    };
  }, []);

  const savedRange = useMemo(() => {
    void storageTick;
    const admin = loadAdminSettingsFromStorage();
    return computeRosterRangeFromSavedData(prefsSnapshot, admin);
  }, [prefsSnapshot, storageTick]);

  const preferenceDayCount = useMemo(
    () => countStoredPreferenceDays(prefsSnapshot),
    [prefsSnapshot],
  );

  const applySuggestedRange = useCallback(() => {
    setGenerateError(null);
    const admin = loadAdminSettingsFromStorage();
    const prefs = loadMemberPreferencesFromStorage();
    const range = computeRosterRangeFromSavedData(prefs, admin);
    if (!range) {
      setGenerateError(
        "希望入力または管理者設定が未登録のため、期間を推定できません。日付を手入力するか、申請・管理者ページでデータを登録してください。",
      );
      return;
    }
    setRangeStart(range.start);
    setRangeEnd(range.end);
  }, []);

  const runFromSaved = useCallback(() => {
    setGenerateError(null);
    const rangeError = validateGenerateRange(rangeStart, rangeEnd);
    if (rangeError) {
      setGenerateError(rangeError);
      return;
    }
    const admin = loadAdminSettingsFromStorage();
    const prefs = loadMemberPreferencesFromStorage();
    const { days: d, unfilled: u } = generateRoster({
      admin,
      rangeStart,
      rangeEnd,
      preferencesByMember: memberPreferencesStoreToGenerateInput(prefs),
    });
    setGeneratedRange({ start: rangeStart, end: rangeEnd });
    setDays(d);
    setUnfilled(u);
  }, [rangeStart, rangeEnd]);

  const runDemo = useCallback(() => {
    setGenerateError(null);
    const rangeError = validateGenerateRange(rangeStart, rangeEnd);
    if (rangeError) {
      setGenerateError(rangeError);
      return;
    }
    const { days: d, unfilled: u } = generateRoster({
      admin: demoAdminSettings(),
      rangeStart,
      rangeEnd,
      preferencesByMember: demoPreferencesByMember(),
    });
    setGeneratedRange({ start: rangeStart, end: rangeEnd });
    setDays(d);
    setUnfilled(u);
  }, [rangeStart, rangeEnd]);

  const csvBlob = useMemo(() => {
    if (!days?.length) return null;
    const raw = rosterDaysToCsv(days);
    return new Blob([csvWithUtf8Bom(raw)], {
      type: "text/csv;charset=utf-8",
    });
  }, [days]);

  const downloadCsv = useCallback(() => {
    if (!csvBlob || !days?.length || !generatedRange) return;
    const url = URL.createObjectURL(csvBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `当番表_${generatedRange.start}_${generatedRange.end}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [csvBlob, days, generatedRange]);

  return (
    <div className="min-h-screen bg-neutral-50 pb-16 dark:bg-neutral-950">
      <header className="border-b border-neutral-200 bg-white/80 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/80">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-8 sm:px-6">
          <p className="text-xs font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
            生成結果
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-50">
            当番表（完成版プレビュー）
          </h1>
          <p className="max-w-2xl text-sm text-neutral-600 dark:text-neutral-400">
            管理者設定と、
            <Link href="/input" className="font-medium text-neutral-900 underline dark:text-neutral-100">
              希望申請ページ
            </Link>
            で入力した休み・夜×など（同じブラウザに自動保存）を反映して当番を割り当てます。当番の回数が可能な限り均等になるよう調整し、AIとして要件定義に基づき極限まで均等化を目指し計算し直します（努力目標）。勤務間インターバルや希望の制約を優先します。
          </p>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6">
        <Section
          title="生成"
          description="生成する期間（開始日〜終了日）を指定してから、当番表を作成してください。申請ページのチェックは入力のたびにこのブラウザへ保存されます。"
        >
          <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/30">
            <p className="text-sm font-medium text-neutral-800 dark:text-neutral-200">
              生成期間
            </p>
            <div className="mt-3 flex flex-wrap items-end gap-4">
              <label className="flex flex-col gap-1 text-sm text-neutral-600 dark:text-neutral-400">
                開始日
                <input
                  type="date"
                  className={inputDateClass}
                  value={rangeStart}
                  onChange={(e) => setRangeStart(e.target.value)}
                />
              </label>
              <span className="pb-2 text-neutral-400">〜</span>
              <label className="flex flex-col gap-1 text-sm text-neutral-600 dark:text-neutral-400">
                終了日
                <input
                  type="date"
                  className={inputDateClass}
                  value={rangeEnd}
                  min={rangeStart}
                  onChange={(e) => setRangeEnd(e.target.value)}
                />
              </label>
              <button
                type="button"
                className={btnSecondary}
                onClick={applySuggestedRange}
                disabled={!savedRange}
              >
                保存データから期間を反映
              </button>
            </div>
            <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
              指定した日付の範囲（両端を含む）で1日ずつ当番を割り当てます。
            </p>
          </div>

          <div className="rounded-xl border border-neutral-200 bg-neutral-50/80 px-4 py-3 text-sm text-neutral-700 dark:border-neutral-800 dark:bg-neutral-900/40 dark:text-neutral-300">
            <p>
              保存済み希望:{" "}
              <span className="font-semibold tabular-nums">{preferenceDayCount}</span> 件（部員×日付）
            </p>
            {savedRange ? (
              <p className="mt-1">
                生成対象期間（推定）:{" "}
                <span className="font-mono tabular-nums">
                  {savedRange.start} 〜 {savedRange.end}
                </span>
                {savedRange.yearMonths.length > 1 ? (
                  <span className="text-neutral-500">（複数月）</span>
                ) : null}
              </p>
            ) : (
              <p className="mt-1 text-amber-800 dark:text-amber-200">
                希望または管理者設定が未登録です。
                <Link href="/input" className="ml-1 underline">
                  申請ページ
                </Link>
                または
                <Link href="/admin" className="ml-1 underline">
                  管理者ページ
                </Link>
                で入力してください。
              </p>
            )}
          </div>

          {generateError ? (
            <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-100">
              {generateError}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <button type="button" className={btnPrimary} onClick={runFromSaved}>
              保存済みの希望・管理者設定で当番表を生成
            </button>
            <button type="button" className={btnSecondary} onClick={runDemo}>
              デモデータで当番表を生成
            </button>
            <button
              type="button"
              className={btnSecondary}
              disabled={!csvBlob}
              onClick={downloadCsv}
            >
              CSV をダウンロード
            </button>
          </div>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            デモボタンは組み込みのサンプル希望のみを使います（申請ページの保存内容は使いません）。いずれも上記の生成期間で作成します。
            {generatedRange ? (
              <>
                {" "}
                直近の生成: {generatedRange.start}〜{generatedRange.end}
              </>
            ) : null}
          </p>
        </Section>

        {unfilled && unfilled.length > 0 ? (
          <Section
            title="未配置の枠"
            description="人員不足や制約の競合により、自動では埋められなかった枠です。運用で手当てしてください。"
          >
            <ul className="list-disc space-y-1 pl-5 text-sm text-red-800 dark:text-red-300">
              {unfilled.map((u, i) => (
                <li key={`${u.date}-${u.slotId}-${i}`}>
                  {u.date} — {u.kind}（{u.slotId}）
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {days && days.length > 0 ? (
          <Section
            title="当番表"
            description="左端は日と曜日のみ（祭日は行事列に統合）。行事列は横書き・約7文字幅で最大2行。各行の高さは行事列の2行分で揃え、全セルを左右・上下中央に配置します。"
          >
            <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
              <table className="min-w-[1000px] w-full border-collapse text-center text-xs sm:text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900/50">
                    <th className="sticky left-0 z-10 border-r border-neutral-200 bg-neutral-50 px-1 py-1 align-middle dark:border-neutral-800 dark:bg-neutral-900/90">
                      <div className="flex flex-col items-center justify-center gap-0 leading-tight">
                        <span>日</span>
                        <span className="text-[10px] font-normal text-neutral-600 dark:text-neutral-400">
                          曜日
                        </span>
                      </div>
                    </th>
                    <th className="w-[7em] min-w-[7em] max-w-[7em] px-1 py-1 align-middle font-medium">
                      行事予定
                    </th>
                    {ROSTER_COLUMN_ORDER.map((name) => (
                      <th key={name} className="whitespace-nowrap px-1 py-1 align-middle font-medium">
                        {name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {buildRosterTableBodyItems(days).map((item) => {
                    if (item.kind === "spacer") {
                      return (
                        <tr key={item.key} aria-hidden className="h-2">
                          <td
                            colSpan={ROSTER_TABLE_COLSPAN}
                            className="border-0 bg-neutral-50/50 p-0 dark:bg-neutral-950/30"
                          />
                        </tr>
                      );
                    }
                    if (item.kind === "month-banner") {
                      return (
                        <tr
                          key={item.key}
                          className="border-b border-neutral-200 bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-800/90"
                        >
                          <td
                            colSpan={ROSTER_TABLE_COLSPAN}
                            className="px-2 py-1.5 text-center text-sm font-semibold tabular-nums tracking-tight text-neutral-800 dark:text-neutral-100"
                          >
                            {formatJapaneseYearMonth(item.yearMonth)}
                          </td>
                        </tr>
                      );
                    }
                    const row = item.row;
                    const rowBg = rowBackgroundClass(row);
                    const stickyBg = stickyCellBgClass(row);
                    return (
                      <tr key={item.key} className={rowBg}>
                        <td
                          className={`sticky left-0 z-10 border-r border-neutral-200 px-1 py-0.5 align-middle dark:border-neutral-800 ${stickyBg}`}
                        >
                          <div className="mx-auto flex min-h-[2.5rem] w-[2.5rem] flex-col items-center justify-center gap-0 leading-none sm:w-10">
                            <span className="text-sm font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
                              {dayOfMonthLabel(row.date)}
                            </span>
                            <span className="mt-0.5 text-[11px] font-medium text-neutral-800 dark:text-neutral-200 sm:text-xs">
                              {row.weekdayLabel}
                            </span>
                          </div>
                        </td>
                        <td className="w-[7em] min-w-[7em] max-w-[7em] px-1 py-0.5 align-middle text-neutral-700 dark:text-neutral-300">
                          <div className="flex min-h-[2.5rem] items-center justify-center">
                            <p
                              className="line-clamp-2 w-full whitespace-pre-line break-words text-center text-[11px] leading-snug [writing-mode:horizontal-tb] sm:text-xs"
                              title={rosterCombinedEventsText(row).replace(/\n/g, " / ")}
                            >
                              {rosterCombinedEventsText(row) || "\u00a0"}
                            </p>
                          </div>
                        </td>
                        {ROSTER_COLUMN_ORDER.map((name) => (
                          <td
                            key={name}
                            className="min-w-[4.25rem] align-middle px-1 py-0.5 text-neutral-800 dark:text-neutral-200"
                          >
                            <DutyAndPreferenceCell name={name} row={row} />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>
        ) : (
          <p className="text-center text-sm text-neutral-500">
            「保存済みの希望・管理者設定で当番表を生成」を押すと、申請ページの入力が反映された表が表示されます。
          </p>
        )}
      </main>
    </div>
  );
}
