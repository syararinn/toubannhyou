import type { AdminSettings, DutyMember, ISODateString, MemberPreferenceInput } from "@/types";

/** デモ用の生成期間 */
export const DEMO_ROSTER_RANGE: { start: ISODateString; end: ISODateString } = {
  start: "2026-01-01",
  end: "2026-01-31",
};

/** デモ用の管理者設定（2026年1月想定） */
export function demoAdminSettings(): AdminSettings {
  return {
    dietSessions: [
      { start: "2026-01-06", end: "2026-01-31", label: "常会（デモ）" },
    ],
    newspaperNonPublicationWorkDates: ["2026-01-11", "2026-01-25"],
    graphExclusivePeriodsForIsobe: [
      { start: "2026-01-18", end: "2026-01-22" },
    ],
    secondmentByDutyMember: {
      磯田: "active",
      江田: "active",
      鈴木: "on_loan",
      南: "active",
      千葉: "active",
      大久保: "active",
      中嶋: "active",
    },
    congressMonthlyAssignments: [
      { yearMonth: "2026-01", dutyMember: "江田" },
    ],
    congressWeeklyAssignments: [
      { yearMonth: "2026-01", weekIndexInMonth: 1, dutyMember: "南" },
      { yearMonth: "2026-01", weekIndexInMonth: 2, dutyMember: "千葉" },
      { yearMonth: "2026-01", weekIndexInMonth: 3, dutyMember: "大久保" },
      { yearMonth: "2026-01", weekIndexInMonth: 4, dutyMember: "中嶋" },
      { yearMonth: "2026-01", weekIndexInMonth: 5, dutyMember: "千葉" },
    ],
    dailyAttendanceOverrides: [
      {
        date: "2026-01-08",
        weekdaySlots: { early: 1, late: 1 },
      },
    ],
  };
}

/** デモ用の希望（一部の日のみ） */
export function demoPreferencesByMember(): Partial<
  Record<DutyMember, MemberPreferenceInput>
> {
  const mk = (
    dutyMember: DutyMember,
    pairs: [string, Partial<import("@/types").MemberDayPreferenceFlags>][],
  ): MemberPreferenceInput => ({
    dutyMember,
    entries: pairs.map(([date, flags]) => ({
      date,
      flags: {
        fullDayOff: false,
        fullyUnavailable: false,
        morningHalfOff: false,
        afternoonHalfOff: false,
        nightUnavailable: false,
        ...flags,
      },
    })),
  });

  return {
    磯田: mk("磯田", [["2026-01-05", { fullDayOff: true }]]),
    江田: mk("江田", [["2026-01-07", { morningHalfOff: true }]]),
    南: mk("南", [["2026-01-09", { afternoonHalfOff: true }]]),
    千葉: mk("千葉", [["2026-01-14", { nightUnavailable: true }]]),
    大久保: mk("大久保", [["2026-01-16", { fullyUnavailable: true }]]),
    中嶋: mk("中嶋", []),
  };
}
