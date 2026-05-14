"use client";

import { Fragment, useCallback, useMemo, useState, type ReactNode } from "react";
import type { GeneratedRosterDay, RosterColumnPerson } from "@/types";
import { ROSTER_COLUMN_ORDER } from "@/types";
import { csvWithUtf8Bom, rosterDaysToCsv } from "@/lib/roster/csv";
import { DEMO_ROSTER_RANGE, demoAdminSettings, demoPreferencesByMember } from "@/lib/roster/demo";
import { generateRoster, type UnfilledSlot } from "@/lib/roster/generate";

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

/** 早番＝濃い青、遅番＝赤。日曜・祝日・振替休日の「メイン」表記は「出勤」に置換（画面表示のみ） */
function formatDutyCellText(raw: string, row: GeneratedRosterDay): ReactNode {
  if (!raw) return "";
  const sunOrHol = isPastelPinkRestDayRow(row);
  const parts = raw.split("・");
  return parts.map((segment, i) => {
    const display =
      sunOrHol && segment === "メイン" ? "出勤" : segment;
    let segClass = "";
    if (segment === "早番") {
      segClass = "font-semibold text-blue-900 dark:text-blue-300";
    } else if (segment === "遅番") {
      segClass = "font-semibold text-red-600 dark:text-red-400";
    } else if (segment === "国会（応援）") {
      segClass = "font-medium text-violet-800 dark:text-violet-300";
    } else if (segment === "国会月番" || segment === "国会週番") {
      segClass = "font-medium text-neutral-800 dark:text-neutral-200";
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
    <div className="flex min-h-[2.25rem] flex-col items-center justify-center gap-0.5 py-0.5">
      <div className="whitespace-pre-wrap text-center leading-snug">
        {formatDutyCellText(dutyRaw, row)}
      </div>
      {marks ? (
        <div className="max-w-[6.5rem] text-center text-[10px] leading-tight text-neutral-500 dark:text-neutral-400">
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

  const runDemo = useCallback(() => {
    const { days: d, unfilled: u } = generateRoster({
      admin: demoAdminSettings(),
      rangeStart: DEMO_ROSTER_RANGE.start,
      rangeEnd: DEMO_ROSTER_RANGE.end,
      preferencesByMember: demoPreferencesByMember(),
    });
    setDays(d);
    setUnfilled(u);
  }, []);

  const csvBlob = useMemo(() => {
    if (!days?.length) return null;
    const raw = rosterDaysToCsv(days);
    return new Blob([csvWithUtf8Bom(raw)], {
      type: "text/csv;charset=utf-8",
    });
  }, [days]);

  const downloadCsv = useCallback(() => {
    if (!csvBlob || !days?.length) return;
    const url = URL.createObjectURL(csvBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `当番表_${DEMO_ROSTER_RANGE.start}_${DEMO_ROSTER_RANGE.end}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [csvBlob, days]);

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
            管理者設定・部員希望に基づき当番を割り当てた結果を表示します。本番では API や共有ストアから同じ入力を渡してください。勤務間インターバルや希望の制約、公平な回数配分のための内部調整を行っています。
          </p>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6">
        <Section
          title="生成"
          description={`デモ用データ（${DEMO_ROSTER_RANGE.start}〜${DEMO_ROSTER_RANGE.end}）で生成します。`}
        >
          <div className="flex flex-wrap gap-3">
            <button type="button" className={btnPrimary} onClick={runDemo}>
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
            description="A 列相当から M 列相当まで、要件定義書【6】の列順です。部員列の下段に、その日付の希望（休・✖・午前半休・午後半休・夜×）を併記します。"
          >
            <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
              <table className="min-w-[1100px] w-full border-collapse text-left text-xs sm:text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900/50">
                    <th className="sticky left-0 z-10 whitespace-nowrap border-r border-neutral-200 bg-neutral-50 px-2 py-2 font-medium dark:border-neutral-800 dark:bg-neutral-900/90">
                      日付
                    </th>
                    <th className="whitespace-nowrap px-2 py-2 font-medium">曜日</th>
                    <th className="whitespace-nowrap px-2 py-2 font-medium">祭日</th>
                    <th className="min-w-[8rem] px-2 py-2 font-medium">行事予定</th>
                    {ROSTER_COLUMN_ORDER.map((name) => (
                      <th key={name} className="whitespace-nowrap px-2 py-2 text-center font-medium">
                        {name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {days.map((row) => {
                    const rowBg = rowBackgroundClass(row);
                    const stickyBg = stickyCellBgClass(row);
                    return (
                      <tr key={row.date} className={rowBg}>
                        <td
                          className={`sticky left-0 z-10 whitespace-nowrap border-r border-neutral-200 px-2 py-1.5 font-mono tabular-nums dark:border-neutral-800 ${stickyBg}`}
                        >
                          {row.date}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5">{row.weekdayLabel}</td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-neutral-700 dark:text-neutral-300">
                          {row.nationalHolidayColumnText}
                        </td>
                        <td className="max-w-[14rem] px-2 py-1.5 text-neutral-700 dark:text-neutral-300">
                          {row.eventsAndNotes}
                        </td>
                        {ROSTER_COLUMN_ORDER.map((name) => (
                          <td
                            key={name}
                            className="min-w-[4.5rem] align-top px-2 py-1.5 text-center text-neutral-800 dark:text-neutral-200"
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
            「デモデータで当番表を生成」を押すと表が表示されます。
          </p>
        )}
      </main>
    </div>
  );
}
