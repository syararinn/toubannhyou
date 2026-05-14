/**
 * 当番表自動生成アプリ — 要件定義書（第8版）に基づくドメイン型定義
 */

/** カレンダー日付（YYYY-MM-DD 形式の文字列として扱う） */
export type ISODateString = string;

// ---------------------------------------------------------------------------
// 【1】ユーザーロール・当番表出力列（完成版 A〜M 列と同一順）
// ---------------------------------------------------------------------------

/** 管理職（当番対象外。D 列行事に連動する手動テキストのみ） */
export type ManagementMember = "牛田" | "倉科";

/** 写真部部員（当番アルゴリズムの対象。序列は要件【5】の並び） */
export type DutyMember = "磯田" | "江田" | "鈴木" | "南" | "千葉" | "大久保" | "中嶋";

/** E〜M 列の見出し順（牛田、倉科、磯田、江田、鈴木、南、千葉、大久保、中嶋） */
export type RosterColumnPerson = ManagementMember | DutyMember;

export const ROSTER_COLUMN_ORDER: readonly RosterColumnPerson[] = [
  "牛田",
  "倉科",
  "磯田",
  "江田",
  "鈴木",
  "南",
  "千葉",
  "大久保",
  "中嶋",
] as const;

/** 部員がログインするロール（管理職は序列順に列挙） */
export type AppUserRole = "management" | "administrator" | "duty_member";

// ---------------------------------------------------------------------------
// 【2】管理者用・事前設定
// ---------------------------------------------------------------------------

/** 国会会期（通常国会・臨時国会等の開会日〜会期末）の一区間 */
export interface DietSessionPeriod {
  start: ISODateString;
  end: ISODateString;
  /** 常会期名など（UI 表示用） */
  label?: string;
}

/** 両端を含む日付範囲（境界の解釈は生成ロジックで統一する） */
export interface LocalDateRange {
  start: ISODateString;
  end: ISODateString;
}

/**
 * 出向ステータス（管理者ダッシュボードの切替）
 * 在籍に戻った時点で当番対象として扱う。
 */
export type SecondmentStatus = "on_loan" | "active";

/**
 * 平日の人数枠（早番・遅番）
 * ハード制約: 各 1 名（管理者の日別上書きで増減し得る）
 */
export interface WeekdaySlotHeadcount {
  early: number;
  late: number;
}

/**
 * 休日側の人数枠（土・日祝のデフォルトに対し、管理者が日別上書き）
 * 土: 1 名、日祝: メイン 1 + 予備 1 が既定（要件【4】）
 */
export interface WeekendHolidaySlotHeadcount {
  /** 土曜の出勤枠人数 */
  saturdayTotal: number;
  /** 日曜・祝日: メイン出勤 */
  sundayOrHolidayMain: number;
  /** 日曜・祝日: 予備出勤 */
  sundayOrHolidayReserve: number;
}

/**
 * 1 日分の出勤人数枠の手動カスタマイズ
 * 未登録の日はシステム既定（平日・土日祝・国会開閉会・休刊特例など）を適用する。
 */
export interface DailyAttendanceHeadcountOverride {
  date: ISODateString;
  weekdaySlots?: WeekdaySlotHeadcount;
  weekendHolidaySlots?: WeekendHolidaySlotHeadcount;
  /** 国会体制・休刊特例など、その他の枠を将来拡張する場合の逃がし口 */
  extraSlotCounts?: Record<string, number>;
}

/** カレンダー上の年月（YYYY-MM） */
export type YearMonthString = string;

/**
 * 国会月当番: 指定部員がその月の全日の平日に「国会月番」として固定配置される。
 */
export interface CongressMonthlyAssignment {
  yearMonth: YearMonthString;
  dutyMember: DutyMember;
}

/**
 * 国会週当番: 指定部員がその月内の「第N週」（月曜始まりの週ブロック）の平日に固定配置される。
 * 会期中は週当番と月当番の2名体制。月当番と同一人物には指定できない。
 */
export interface CongressWeeklyAssignment {
  yearMonth: YearMonthString;
  weekIndexInMonth: 1 | 2 | 3 | 4 | 5 | 6;
  dutyMember: DutyMember;
}

/** 管理者が部員入力画面展開前に登録する事前設定一式 */
export interface AdminSettings {
  dietSessions: DietSessionPeriod[];
  /** 新聞休刊作業日（年間 10〜15 回程度想定） */
  newspaperNonPublicationWorkDates: ISODateString[];
  /** グラフ専任期間（対象は磯田のみ。年 4 回など） */
  graphExclusivePeriodsForIsobe: LocalDateRange[];
  /** 各部員の出向中 / 在籍（出力列は出向中を常に空白） */
  secondmentByDutyMember: Record<DutyMember, SecondmentStatus>;
  /** 日ごとの出勤人数枠の上書き（年末年始など） */
  dailyAttendanceOverrides: DailyAttendanceHeadcountOverride[];
  /** 対象月ごとの国会月当番（管理職が指定） */
  congressMonthlyAssignments: CongressMonthlyAssignment[];
  /** 対象月・第N週ごとの国会週当番（管理職が指定） */
  congressWeeklyAssignments: CongressWeeklyAssignment[];
}

// ---------------------------------------------------------------------------
// 【3】部員希望入力（5 項目・上限ルール用の定数は別モジュールで参照してもよい）
// ---------------------------------------------------------------------------

/** 希望フラグ（休・✖️・午前半休・午後半休・夜✖️） */
export interface MemberDayPreferenceFlags {
  /** 休 */
  fullDayOff: boolean;
  /** ✖️（全日配置不可） */
  fullyUnavailable: boolean;
  /** 午前半休 */
  morningHalfOff: boolean;
  /** 午後半休 */
  afternoonHalfOff: boolean;
  /** 夜✖️ */
  nightUnavailable: boolean;
}

/** 月次の希望上限制御（基本グループ合算 原則 3、夜✖️は独立して 3） */
export interface PreferenceMonthlyCaps {
  maxBasePreferenceMarksPerMonth: number;
  maxNightUnavailableMarksPerMonth: number;
}

/** 要件【3】の既定上限 */
export const DEFAULT_PREFERENCE_MONTHLY_CAPS: PreferenceMonthlyCaps = {
  maxBasePreferenceMarksPerMonth: 3,
  maxNightUnavailableMarksPerMonth: 3,
};

export interface MemberPreferenceDayEntry {
  date: ISODateString;
  flags: MemberDayPreferenceFlags;
}

/** 1 部員分の希望入力データ */
export interface MemberPreferenceInput {
  dutyMember: DutyMember;
  entries: MemberPreferenceDayEntry[];
}

// ---------------------------------------------------------------------------
// 【4】【5】アルゴリズム用 — 序列（下位優先はフロント公開禁止。型はバックエンド等で使用）
// ---------------------------------------------------------------------------

/**
 * 当番回数の端数を吸収する際の「序列下位」から「上位」への順序（要件【5】本文どおり）
 * 同順位の比較やソートキーに使用する。
 */
export const DUTY_MEMBER_RANK_PRIORITY_ORDER: readonly DutyMember[] = [
  "中嶋",
  "大久保",
  "千葉",
  "南",
  "鈴木",
  "江田",
  "磯田",
] as const;

/** 1 = 最下位（中嶋）… 7 = 最上位（磯田）。`DUTY_MEMBER_RANK_PRIORITY_ORDER` と整合 */
export type DutyMemberRankOrder = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const DUTY_MEMBER_RANK_ORDER_BY_MEMBER: Record<
  DutyMember,
  DutyMemberRankOrder
> = {
  中嶋: 1,
  大久保: 2,
  千葉: 3,
  南: 4,
  鈴木: 5,
  江田: 6,
  磯田: 7,
};

// ---------------------------------------------------------------------------
// 【6】完成版当番表の 1 日分（A 列〜M 列）
// ---------------------------------------------------------------------------

/**
 * A 列: 日付、B 列: 曜日、C 列: 祭日、D 列: 行事予定、
 * E〜M 列: 牛田〜中嶋（セルは割当記号・手動メモ・空白などを格納）
 */
export interface GeneratedRosterDay {
  /** A 列 */
  date: ISODateString;
  /** B 列（例: 「月」） */
  weekdayLabel: string;
  /** C 列（非祭日・非該当は空文字など UI 方針に合わせる） */
  nationalHolidayColumnText: string;
  /** D 列（休刊日・国会予定等の手動入力を含む） */
  eventsAndNotes: string;
  /** E〜M 列。管理職列は手動テキスト、出向中の部員列は原則空白文字列 */
  rosterCellsByColumnPerson: Record<RosterColumnPerson, string>;
}
