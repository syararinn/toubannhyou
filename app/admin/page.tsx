"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  AdminSettings,
  CongressWeeklyAssignment,
  DailyAttendanceHeadcountOverride,
  DietSessionPeriod,
  DutyMember,
  LocalDateRange,
  SecondmentStatus,
  WeekendHolidaySlotHeadcount,
  WeekdaySlotHeadcount,
} from "@/types";
import { ROSTER_COLUMN_ORDER } from "@/types";
import {
  loadAdminSettingsFromStorage,
  saveAdminSettingsToStorage,
} from "@/lib/adminSettingsStorage";

const DUTY_MEMBERS = ROSTER_COLUMN_ORDER.filter(
  (name): name is DutyMember => name !== "牛田" && name !== "倉科",
);

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

function Label({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return (
    <label
      htmlFor={htmlFor}
      className="block text-sm font-medium text-neutral-700 dark:text-neutral-300"
    >
      {children}
    </label>
  );
}

const inputClass =
  "mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm outline-none transition focus:border-neutral-500 focus:ring-2 focus:ring-neutral-400/30 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:border-neutral-400 dark:focus:ring-neutral-500/30";

const btnPrimary =
  "inline-flex items-center justify-center rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white";

const btnSecondary =
  "inline-flex items-center justify-center rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-800 shadow-sm transition hover:bg-neutral-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800";

const btnDanger =
  "inline-flex items-center justify-center rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-50 dark:border-red-900/60 dark:bg-neutral-900 dark:text-red-400 dark:hover:bg-red-950/40";

export default function AdminSettingsPage() {
  const [settings, setSettings] = useState<AdminSettings>(loadAdminSettingsFromStorage);

  useEffect(() => {
    saveAdminSettingsToStorage(settings);
  }, [settings]);

  const [congressYearMonth, setCongressYearMonth] = useState("2026-01");
  const [congressMonthlyMember, setCongressMonthlyMember] = useState<DutyMember | "">("");
  const [congressWeeklyMembers, setCongressWeeklyMembers] = useState<
    (DutyMember | "")[]
  >(["", "", "", "", "", ""]);
  const [congressFormError, setCongressFormError] = useState<string | null>(null);

  useEffect(() => {
    const ym = congressYearMonth.trim();
    const monthly =
      settings.congressMonthlyAssignments.find((a) => a.yearMonth === ym)?.dutyMember ?? "";
    setCongressMonthlyMember(monthly);
    const weeks: (DutyMember | "")[] = [];
    for (let wi = 1; wi <= 6; wi++) {
      const hit = settings.congressWeeklyAssignments.find(
        (a) => a.yearMonth === ym && a.weekIndexInMonth === wi,
      );
      weeks.push(hit?.dutyMember ?? "");
    }
    setCongressWeeklyMembers(weeks);
  }, [congressYearMonth, settings.congressMonthlyAssignments, settings.congressWeeklyAssignments]);

  const [dietDraft, setDietDraft] = useState<DietSessionPeriod>({
    start: "",
    end: "",
    label: "",
  });

  const [newspaperDraft, setNewspaperDraft] = useState("");

  const [graphDraft, setGraphDraft] = useState<LocalDateRange>({
    start: "",
    end: "",
  });

  const sortedNewspaperDates = useMemo(
    () => [...settings.newspaperNonPublicationWorkDates].sort(),
    [settings.newspaperNonPublicationWorkDates],
  );

  function addDietSession() {
    if (!dietDraft.start || !dietDraft.end) return;
    setSettings((s) => ({
      ...s,
      dietSessions: [
        ...s.dietSessions,
        {
          start: dietDraft.start,
          end: dietDraft.end,
          label: dietDraft.label?.trim() || undefined,
        },
      ],
    }));
    setDietDraft({ start: "", end: "", label: "" });
  }

  function removeDietSession(index: number) {
    setSettings((s) => ({
      ...s,
      dietSessions: s.dietSessions.filter((_, i) => i !== index),
    }));
  }

  function addNewspaperDate() {
    const d = newspaperDraft.trim();
    if (!d) return;
    if (settings.newspaperNonPublicationWorkDates.includes(d)) {
      setNewspaperDraft("");
      return;
    }
    setSettings((s) => ({
      ...s,
      newspaperNonPublicationWorkDates: [...s.newspaperNonPublicationWorkDates, d],
    }));
    setNewspaperDraft("");
  }

  function removeNewspaperDate(date: string) {
    setSettings((s) => ({
      ...s,
      newspaperNonPublicationWorkDates: s.newspaperNonPublicationWorkDates.filter(
        (x) => x !== date,
      ),
    }));
  }

  function addGraphPeriod() {
    if (!graphDraft.start || !graphDraft.end) return;
    setSettings((s) => ({
      ...s,
      graphExclusivePeriodsForIsobe: [...s.graphExclusivePeriodsForIsobe, { ...graphDraft }],
    }));
    setGraphDraft({ start: "", end: "" });
  }

  function removeGraphPeriod(index: number) {
    setSettings((s) => ({
      ...s,
      graphExclusivePeriodsForIsobe: s.graphExclusivePeriodsForIsobe.filter(
        (_, i) => i !== index,
      ),
    }));
  }

  function setSecondment(member: DutyMember, status: SecondmentStatus) {
    setSettings((s) => ({
      ...s,
      secondmentByDutyMember: { ...s.secondmentByDutyMember, [member]: status },
    }));
  }

  function addAttendanceOverride() {
    const row: DailyAttendanceHeadcountOverride = {
      date: "",
    };
    setSettings((s) => ({
      ...s,
      dailyAttendanceOverrides: [...s.dailyAttendanceOverrides, row],
    }));
  }

  function updateAttendanceOverride(
    index: number,
    patch: Partial<DailyAttendanceHeadcountOverride>,
  ) {
    setSettings((s) => ({
      ...s,
      dailyAttendanceOverrides: s.dailyAttendanceOverrides.map((row, i) =>
        i === index ? { ...row, ...patch } : row,
      ),
    }));
  }

  function setWeekdayOverride(index: number, slots: WeekdaySlotHeadcount | undefined) {
    setSettings((s) => ({
      ...s,
      dailyAttendanceOverrides: s.dailyAttendanceOverrides.map((row, i) =>
        i === index ? { ...row, weekdaySlots: slots } : row,
      ),
    }));
  }

  function setWeekendOverride(
    index: number,
    slots: WeekendHolidaySlotHeadcount | undefined,
  ) {
    setSettings((s) => ({
      ...s,
      dailyAttendanceOverrides: s.dailyAttendanceOverrides.map((row, i) =>
        i === index ? { ...row, weekendHolidaySlots: slots } : row,
      ),
    }));
  }

  function removeAttendanceOverride(index: number) {
    setSettings((s) => ({
      ...s,
      dailyAttendanceOverrides: s.dailyAttendanceOverrides.filter((_, i) => i !== index),
    }));
  }

  function saveCongressAssignments() {
    setCongressFormError(null);
    const ym = congressYearMonth.trim();
    if (!/^\d{4}-\d{2}$/.test(ym)) {
      setCongressFormError("年月は YYYY-MM 形式で入力してください。");
      return;
    }
    const monthly = congressMonthlyMember || undefined;
    if (monthly) {
      for (let i = 0; i < congressWeeklyMembers.length; i++) {
        const w = congressWeeklyMembers[i];
        if (w && w === monthly) {
          setCongressFormError(
            "国会月当番に指定した部員を、同じ月の国会週当番に指定することはできません。",
          );
          return;
        }
      }
    }

    const weeklyToSave: CongressWeeklyAssignment[] = [];
    congressWeeklyMembers.forEach((m, idx) => {
      if (!m) return;
      const weekIndex = (idx + 1) as CongressWeeklyAssignment["weekIndexInMonth"];
      weeklyToSave.push({ yearMonth: ym, weekIndexInMonth: weekIndex, dutyMember: m });
    });

    setSettings((s) => {
      const monthlyRest = s.congressMonthlyAssignments.filter((a) => a.yearMonth !== ym);
      const weeklyRest = s.congressWeeklyAssignments.filter((a) => a.yearMonth !== ym);
      return {
        ...s,
        congressMonthlyAssignments: monthly
          ? [...monthlyRest, { yearMonth: ym, dutyMember: monthly }]
          : monthlyRest,
        congressWeeklyAssignments: [...weeklyRest, ...weeklyToSave],
      };
    });
  }

  return (
    <div className="min-h-screen bg-neutral-50 pb-16 dark:bg-neutral-950">
      <header className="border-b border-neutral-200 bg-white/80 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/80">
        <div className="mx-auto flex max-w-3xl flex-col gap-1 px-4 py-8 sm:px-6">
          <p className="text-xs font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
            管理者向け
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-50">
            事前設定ダッシュボード
          </h1>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            部員の入力画面を開く前に、会期・休刊日・人数枠などを登録します。現在の内容はブラウザ内のみに保持されます（モック）。
          </p>
        </div>
      </header>

      <main className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-10 sm:px-6">
        <Section
          title="国会会期"
          description="通常国会・臨時国会など、開会日から会期末までを登録します。複数会期がある場合は行を追加してください。"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="diet-start">開始日</Label>
              <input
                id="diet-start"
                type="date"
                className={inputClass}
                value={dietDraft.start}
                onChange={(e) => setDietDraft((d) => ({ ...d, start: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="diet-end">終了日</Label>
              <input
                id="diet-end"
                type="date"
                className={inputClass}
                value={dietDraft.end}
                onChange={(e) => setDietDraft((d) => ({ ...d, end: e.target.value }))}
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="diet-label">会期ラベル（任意）</Label>
              <input
                id="diet-label"
                type="text"
                placeholder="例: 第216回国会 常会"
                className={inputClass}
                value={dietDraft.label ?? ""}
                onChange={(e) => setDietDraft((d) => ({ ...d, label: e.target.value }))}
              />
            </div>
          </div>
          <button type="button" className={btnPrimary} onClick={addDietSession}>
            会期を追加
          </button>
          {settings.dietSessions.length > 0 ? (
            <ul className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
              {settings.dietSessions.map((row, i) => (
                <li
                  key={`${row.start}-${row.end}-${i}`}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
                >
                  <div>
                    <p className="font-medium text-neutral-900 dark:text-neutral-100">
                      {row.start} 〜 {row.end}
                    </p>
                    {row.label ? (
                      <p className="text-neutral-600 dark:text-neutral-400">{row.label}</p>
                    ) : null}
                  </div>
                  <button type="button" className={btnDanger} onClick={() => removeDietSession(i)}>
                    削除
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-neutral-500 dark:text-neutral-500">登録された会期はありません。</p>
          )}
        </Section>

        <Section
          title="新聞休刊作業日"
          description="年間 10〜15 回程度を想定した休刊作業日を登録します。"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Label htmlFor="np-date">日付を追加</Label>
              <input
                id="np-date"
                type="date"
                className={inputClass}
                value={newspaperDraft}
                onChange={(e) => setNewspaperDraft(e.target.value)}
              />
            </div>
            <button type="button" className={btnPrimary} onClick={addNewspaperDate}>
              追加
            </button>
          </div>
          {sortedNewspaperDates.length > 0 ? (
            <ul className="flex flex-wrap gap-2">
              {sortedNewspaperDates.map((d) => (
                <li
                  key={d}
                  className="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
                >
                  <span className="tabular-nums text-neutral-800 dark:text-neutral-200">{d}</span>
                  <button
                    type="button"
                    className="text-neutral-500 hover:text-red-600 dark:hover:text-red-400"
                    aria-label={`${d} を削除`}
                    onClick={() => removeNewspaperDate(d)}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-neutral-500">まだ日付が追加されていません。</p>
          )}
        </Section>

        <Section
          title="グラフ専任期間（磯田）"
          description="磯田さんを対象とするグラフ専任期間を登録します（年 4 回など）。"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="graph-start">開始日</Label>
              <input
                id="graph-start"
                type="date"
                className={inputClass}
                value={graphDraft.start}
                onChange={(e) => setGraphDraft((g) => ({ ...g, start: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="graph-end">終了日</Label>
              <input
                id="graph-end"
                type="date"
                className={inputClass}
                value={graphDraft.end}
                onChange={(e) => setGraphDraft((g) => ({ ...g, end: e.target.value }))}
              />
            </div>
          </div>
          <button type="button" className={btnPrimary} onClick={addGraphPeriod}>
            期間を追加
          </button>
          {settings.graphExclusivePeriodsForIsobe.length > 0 ? (
            <ul className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
              {settings.graphExclusivePeriodsForIsobe.map((row, i) => (
                <li
                  key={`${row.start}-${row.end}-${i}`}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
                >
                  <span className="font-medium tabular-nums text-neutral-900 dark:text-neutral-100">
                    {row.start} 〜 {row.end}
                  </span>
                  <button type="button" className={btnDanger} onClick={() => removeGraphPeriod(i)}>
                    削除
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-neutral-500">登録された期間はありません。</p>
          )}
        </Section>

        <Section
          title="国会当番の指定（管理職指示）"
          description="国会月当番は対象月の全日の平日に同一人物が入ります。国会週当番は月内の第1週〜第6週（月曜始まりの週ブロック）ごとに、その週の平日は同一人物が担当します。会期中は月＋週の2名、閉会中は月のみ1名です。月当番と同一人物を週当番に指定することはできません。"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="congress-ym">対象月（YYYY-MM）</Label>
              <input
                id="congress-ym"
                type="month"
                className={inputClass}
                value={congressYearMonth}
                onChange={(e) => setCongressYearMonth(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="congress-monthly">国会月当番（1名）</Label>
              <select
                id="congress-monthly"
                className={inputClass}
                value={congressMonthlyMember}
                onChange={(e) =>
                  setCongressMonthlyMember((e.target.value || "") as DutyMember | "")
                }
              >
                <option value="">未指定</option>
                {DUTY_MEMBERS.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-neutral-800 dark:text-neutral-200">
              国会週当番（第1週〜第6週）
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {congressWeeklyMembers.map((val, idx) => (
                <div key={idx}>
                  <Label htmlFor={`congress-w-${idx}`}>第{idx + 1}週</Label>
                  <select
                    id={`congress-w-${idx}`}
                    className={inputClass}
                    value={val}
                    onChange={(e) => {
                      const v = (e.target.value || "") as DutyMember | "";
                      setCongressWeeklyMembers((prev) => {
                        const next = [...prev];
                        next[idx] = v;
                        return next;
                      });
                    }}
                  >
                    <option value="">未指定</option>
                    {DUTY_MEMBERS.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>

          {congressFormError ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
              {congressFormError}
            </p>
          ) : null}

          <button type="button" className={btnPrimary} onClick={saveCongressAssignments}>
            この月の国会当番を登録
          </button>
          <p className="text-xs text-neutral-500 dark:text-neutral-500">
            登録済みの同じ年月の設定は上書きされます。JSON 確認欄にも反映されます。
          </p>
        </Section>

        <Section
          title="出向ステータス"
          description="各部員の「在籍」「出向中」を切り替えます。出向中の部員は当番アルゴリズムから除外されます。"
        >
          <ul className="space-y-3">
            {DUTY_MEMBERS.map((member) => {
              const status = settings.secondmentByDutyMember[member];
              return (
                <li
                  key={member}
                  className="flex flex-col justify-between gap-3 rounded-xl border border-neutral-200 px-4 py-3 sm:flex-row sm:items-center dark:border-neutral-800"
                >
                  <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                    {member}
                  </span>
                  <div className="inline-flex rounded-lg border border-neutral-200 p-0.5 dark:border-neutral-700">
                    <button
                      type="button"
                      className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                        status === "active"
                          ? "bg-neutral-900 text-white shadow dark:bg-neutral-100 dark:text-neutral-900"
                          : "text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
                      }`}
                      onClick={() => setSecondment(member, "active")}
                    >
                      在籍
                    </button>
                    <button
                      type="button"
                      className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                        status === "on_loan"
                          ? "bg-neutral-900 text-white shadow dark:bg-neutral-100 dark:text-neutral-900"
                          : "text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
                      }`}
                      onClick={() => setSecondment(member, "on_loan")}
                    >
                      出向中
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </Section>

        <Section
          title="日ごとの出勤人数枠"
          description="土日祝の既定人数や平日の早番・遅番を、特定の日だけ上書きします（年末年始の増員など）。"
        >
          <button type="button" className={btnSecondary} onClick={addAttendanceOverride}>
            行を追加
          </button>
          {settings.dailyAttendanceOverrides.length === 0 ? (
            <p className="text-sm text-neutral-500">上書き行がありません。「行を追加」から登録してください。</p>
          ) : (
            <div className="space-y-6">
              {settings.dailyAttendanceOverrides.map((row, index) => (
                <AttendanceOverrideCard
                  key={index}
                  rowKey={index}
                  row={row}
                  onChangeDate={(date) => updateAttendanceOverride(index, { date })}
                  onChangeWeekday={(slots) => setWeekdayOverride(index, slots)}
                  onChangeWeekend={(slots) => setWeekendOverride(index, slots)}
                  onRemove={() => removeAttendanceOverride(index)}
                />
              ))}
            </div>
          )}
        </Section>

        <Section title="保持中のデータ（確認用）" description="useState に載っている AdminSettings の JSON です。">
          <pre className="max-h-80 overflow-auto rounded-xl bg-neutral-900 p-4 text-xs leading-relaxed text-neutral-100 dark:bg-neutral-900">
            {JSON.stringify(settings, null, 2)}
          </pre>
        </Section>
      </main>
    </div>
  );
}

function AttendanceOverrideCard({
  rowKey,
  row,
  onChangeDate,
  onChangeWeekday,
  onChangeWeekend,
  onRemove,
}: {
  rowKey: number;
  row: DailyAttendanceHeadcountOverride;
  onChangeDate: (date: string) => void;
  onChangeWeekday: (slots: WeekdaySlotHeadcount | undefined) => void;
  onChangeWeekend: (slots: WeekendHolidaySlotHeadcount | undefined) => void;
  onRemove: () => void;
}) {
  const hasWeekday = row.weekdaySlots !== undefined;
  const hasWeekend = row.weekendHolidaySlots !== undefined;

  const wd = row.weekdaySlots ?? { early: 1, late: 1 };
  const we = row.weekendHolidaySlots ?? {
    saturdayTotal: 1,
    sundayOrHolidayMain: 1,
    sundayOrHolidayReserve: 1,
  };

  return (
    <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-[12rem] flex-1">
          <Label htmlFor={`ov-date-${rowKey}`}>対象日</Label>
          <input
            id={`ov-date-${rowKey}`}
            type="date"
            className={inputClass}
            value={row.date}
            onChange={(e) => onChangeDate(e.target.value)}
          />
        </div>
        <button type="button" className={btnDanger} onClick={onRemove}>
          行を削除
        </button>
      </div>

      <div className="mt-4 grid gap-6 border-t border-neutral-100 pt-4 dark:border-neutral-800/80 sm:grid-cols-2">
        <div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-neutral-800 dark:text-neutral-200">平日（早番・遅番）</p>
            <label className="flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-400">
              <input
                type="checkbox"
                className="rounded border-neutral-300 dark:border-neutral-600"
                checked={hasWeekday}
                onChange={(e) => {
                  if (e.target.checked) {
                    onChangeWeekday({ early: wd.early, late: wd.late });
                  } else {
                    onChangeWeekday(undefined);
                  }
                }}
              />
              上書きする
            </label>
          </div>
          {hasWeekday ? (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <Label>早番</Label>
                <input
                  type="number"
                  min={0}
                  className={inputClass}
                  value={row.weekdaySlots!.early}
                  onChange={(e) =>
                    onChangeWeekday({
                      ...row.weekdaySlots!,
                      early: Number(e.target.value),
                    })
                  }
                />
              </div>
              <div>
                <Label>遅番</Label>
                <input
                  type="number"
                  min={0}
                  className={inputClass}
                  value={row.weekdaySlots!.late}
                  onChange={(e) =>
                    onChangeWeekday({
                      ...row.weekdaySlots!,
                      late: Number(e.target.value),
                    })
                  }
                />
              </div>
            </div>
          ) : (
            <p className="mt-2 text-xs text-neutral-500">チェックを入れると早番・遅番の人数を指定できます。</p>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-neutral-800 dark:text-neutral-200">土日祝の枠</p>
            <label className="flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-400">
              <input
                type="checkbox"
                className="rounded border-neutral-300 dark:border-neutral-600"
                checked={hasWeekend}
                onChange={(e) => {
                  if (e.target.checked) {
                    onChangeWeekend({
                      saturdayTotal: we.saturdayTotal,
                      sundayOrHolidayMain: we.sundayOrHolidayMain,
                      sundayOrHolidayReserve: we.sundayOrHolidayReserve,
                    });
                  } else {
                    onChangeWeekend(undefined);
                  }
                }}
              />
              上書きする
            </label>
          </div>
          {hasWeekend ? (
            <div className="mt-3 space-y-3">
              <div>
                <Label>土曜の出勤枠</Label>
                <input
                  type="number"
                  min={0}
                  className={inputClass}
                  value={row.weekendHolidaySlots!.saturdayTotal}
                  onChange={(e) =>
                    onChangeWeekend({
                      ...row.weekendHolidaySlots!,
                      saturdayTotal: Number(e.target.value),
                    })
                  }
                />
              </div>
              <div>
                <Label>日曜・祝（メイン）</Label>
                <input
                  type="number"
                  min={0}
                  className={inputClass}
                  value={row.weekendHolidaySlots!.sundayOrHolidayMain}
                  onChange={(e) =>
                    onChangeWeekend({
                      ...row.weekendHolidaySlots!,
                      sundayOrHolidayMain: Number(e.target.value),
                    })
                  }
                />
              </div>
              <div>
                <Label>日曜・祝（予備）</Label>
                <input
                  type="number"
                  min={0}
                  className={inputClass}
                  value={row.weekendHolidaySlots!.sundayOrHolidayReserve}
                  onChange={(e) =>
                    onChangeWeekend({
                      ...row.weekendHolidaySlots!,
                      sundayOrHolidayReserve: Number(e.target.value),
                    })
                  }
                />
              </div>
            </div>
          ) : (
            <p className="mt-2 text-xs text-neutral-500">チェックを入れると土日祝の人数枠を指定できます。</p>
          )}
        </div>
      </div>
    </div>
  );
}
