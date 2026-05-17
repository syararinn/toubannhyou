/**
 * 当番表自動生成アプリ — 要件定義書（第8版）に基づくドメイン型定義
 */

/** カレンダー日付（YYYY-MM-DD 形式の文字列として扱う） */
export type ISODateString = string;

// ---------------------------------------------------------------------------
// 【1】ユーザーロール・当番表の管理職列（完成版では D 列以降の見出し順）
// ---------------------------------------------------------------------------

/** 管理職（当番対象外。行事は表の C 列に統合表示、手動テキストは管理職列） */
export type ManagementMember = "牛田" | "倉科";

/** 写真部部員（当番アルゴリズムの対象。序列は要件【5】の並び） */
export type DutyMember = "磯田" | "江田" | "鈴木" | "南" | "千葉" | "大久保" | "中嶋";

/** 管理職列の見出し順（牛田、倉科、磯田、…）。`ROSTER_COLUMN_ORDER.length` は運用で変更可 */
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
 * 同日に早番・遅番・メイン・予備は兼務しない。
 */
export interface CongressMonthlyAssignment {
  yearMonth: YearMonthString;
  dutyMember: DutyMember;
}

/**
 * 国会週当番: 指定部員がその月内の「第N週」の平日に固定配置される。
 * 第1週は最初の月曜より前の日のみ、第2週以降は各月曜始まりのブロック（月初が月曜の月は第1週に該当日なし）。
 * 会期中は週当番と月当番の2名体制。月当番と同一人物には指定できない。
 * 同日に早番・遅番・メイン・予備は兼務しない。
 */
export interface CongressWeeklyAssignment {
  yearMonth: YearMonthString;
  weekIndexInMonth: 1 | 2 | 3 | 4 | 5 | 6;
  dutyMember: DutyMember;
}

/** 休刊作業に出勤と指定できる人（部員7名＋管理職・倉科） */
export type NewspaperNonPublicationAssignee = DutyMember | "倉科";

/** 新聞休刊作業日の 1 行分（日曜または祝日のみ。出勤者は 1 名） */
export interface NewspaperNonPublicationWorkDay {
  date: ISODateString;
  /**
   * その日の休刊作業の出勤者（1名のみ）。未指定のときは当番セルは空。
   * 倉科が当番として「出勤」になるのは原則この指定がある日のみ。
   */
  assignee: NewspaperNonPublicationAssignee | null;
}

/**
 * 国民の祝日・祝日法に基づく休日など（1日1行）。
 * アプリ同梱の年以外や未収載日は、内閣府の一覧から管理者が入力する。
 */
export interface NationalHolidayManualEntry {
  date: ISODateString;
  /** 行事列などに出す名称（例: 元日、休日） */
  name: string;
}

/** 管理者が部員入力画面展開前に登録する事前設定一式 */
export interface AdminSettings {
  dietSessions: DietSessionPeriod[];
  /**
   * 同梱祝日にない年・振替・休日などを追加する（同一日付はこちらが優先）。
   * 内閣府「国民の祝日について」の表を参照して年末に翌年分を登録する想定。
   */
  nationalHolidaysManual: NationalHolidayManualEntry[];
  /** 新聞休刊作業日（年間 10〜15 回程度想定）と、その日の出勤者（1名）の指定 */
  newspaperNonPublicationWorkDays: NewspaperNonPublicationWorkDay[];
  /** グラフ専任期間（対象は磯田のみ。年 4 回など）。期間中は磯田を全当番枠から除外する。 */
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

/**
 * 希望フラグ（休・✖️・午前半休・午後半休・夜✖️）
 *
 * 当番生成におけるハード制約（抜粋・アルゴリズムと整合）:
 * - 「休」「✖️」: その日のいかなる枠（早番・遅番・メイン・予備・国会月番・国会週番など）にも配置しない。
 * - 同日: 午前半休と午後半休、午前半休と夜✖は併用不可（入力 UI で制限）。
 * - 「午前半休」: 早番・メイン（休日のメイン出勤）にはハード不可。国会月番・週番・国会（指名枠）には配置可（その日に半休がある指名者ごとに、別枠「国会（応援）」を追加して補う）。
 * - 「午後半休」: 遅番・予備・国会（応援）にはハード不可。国会月番・週番・国会（指名枠）には配置可（半休の指名者がいる日は「国会（応援）」枠を追加）。
 * - 「夜✖️」: 遅番と休日出勤（土日祝のメイン枠）のみハード不可。早番は可。休日の予備はハード可だが、日曜・祝日の予備は夜✖️の人を他に候補がいる限り避ける（生成ロジック）。
 * - 国会月番・国会週番の指名者: その月／その週ブロックの平日は早番・遅番と兼務しない（国会枠または国会（応援）のみ）。
 * - 磯田のグラフ専任期間中: 磯田は全日の当番枠から除外（早番・遅番・メイン・予備・国会含む）。
 * - 日曜・祝日のメイン出勤の翌日: その部員への早番は原則つけない。他に配置可能な候補がいない場合は割り当て可（生成ロジック）。
 * - 休日（土曜・日曜・祝日）の出勤: 同一部員の休日連続出勤は原則避ける。他に配置可能な候補がいない場合は割り当て可（生成ロジック）。
 * - 早番・遅番: 前日と同じ部員への早番／遅番の連続は原則避ける。他に配置可能な候補がいない場合は割り当て可（生成ロジック）。
 * - 早番・遅番: 週ごと（月曜始まり）に、早番は早番のみ・遅番は遅番のみを別カウントして同数に近づける。国会指名・グラフ専任・出向者は集計・割当対象外（生成ロジック）。
 */
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

/**
 * 月次の希望上限制御（休・✖ 合算 原則 3、午前・午後半休 原則 3、夜✖️ 原則 3）。
 * 超過時は部員が月あたり最大5回まで申請でき、部長が休・✖／夜✖ それぞれ 0〜30 件の追加枠を別設定で承認する（承認分は同月内で加算）。
 */
export interface PreferenceMonthlyCaps {
  maxBasePreferenceMarksPerMonth: number;
  maxNightUnavailableMarksPerMonth: number;
}

/** 要件【3】の既定上限 */
export const DEFAULT_PREFERENCE_MONTHLY_CAPS: PreferenceMonthlyCaps = {
  maxBasePreferenceMarksPerMonth: 3,
  maxNightUnavailableMarksPerMonth: 3,
};

/** 午前・午後半休の月次上限（申請・承認の対象外。超過時は入力不可） */
export const DEFAULT_HALF_DAY_MARKS_PER_MONTH = 3;

/** 部長承認で追加できる休・✖ の上限件数（1ヶ月あたり） */
export const MAX_APPROVED_EXTRA_REST_CROSS_MARKS = 30;

/** 部長承認で追加できる夜✖ の上限件数（1ヶ月あたり） */
export const MAX_APPROVED_EXTRA_NIGHT_MARKS = 30;

export type PreferenceLimitApplicationStatus = "pending" | "approved" | "rejected";

/** 部員あたり・月あたりの申請回数上限 */
export const MAX_PREFERENCE_LIMIT_APPLICATIONS_PER_MONTH = 5;

/**
 * 希望上限の超過申請（部員あたり・月あたり最大5件）。
 * 翌月は承認加算分をリセットし、既定の3件から再カウントする。
 */
export interface PreferenceLimitApplication {
  /** 申請ごとの一意ID */
  id: string;
  dutyMember: DutyMember;
  yearMonth: YearMonthString;
  status: PreferenceLimitApplicationStatus;
  submittedAt: string;
  /** 休・✖ 超過時の理由（該当しなければ空） */
  restCrossReason: string;
  /** 夜✖ 超過時の理由（該当しなければ空） */
  nightReason: string;
  restCrossMarksAtSubmit: number;
  nightMarksAtSubmit: number;
  /** 承認後: 既定3に加算する休・✖ 枠（0〜30） */
  approvedExtraRestCross: number;
  /** 承認後: 既定3に加算する夜✖ 枠（0〜30） */
  approvedExtraNight: number;
  reviewedAt?: string;
}

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
// 【6】完成版当番表の 1 日分（表示列は可変。既定は A〜C＋管理職列）
// ---------------------------------------------------------------------------

/**
 * データ上のフィールドと表の対応（画面・CSV の列構成は運用で拡張可）:
 * - 表 A 列: `date` から導出した「日」のみ（年月は月区切り行などで別表示）
 * - 表 B 列: `weekdayLabel`
 * - 表 C 列: `eventsAndNotes` と `nationalHolidayColumnText` を UI 側で統合した行事
 * - 表 D 列以降: `ROSTER_COLUMN_ORDER` の順の管理職列（人数は型・配列の変更で増減可）
 */
export interface GeneratedRosterDay {
  /** 日付（ISO）。表の A 列はここから日のみを表示 */
  date: ISODateString;
  /** 曜日ラベル（例:「月」）。表 B 列 */
  weekdayLabel: string;
  /** 祭日名など。表 C 列の行事テキストに統合して表示 */
  nationalHolidayColumnText: string;
  /** 行事・備考。表 C 列の行事テキストに統合して表示 */
  eventsAndNotes: string;
  /** 管理職（当番列）ごとのセル。列順は `ROSTER_COLUMN_ORDER` */
  rosterCellsByColumnPerson: Record<RosterColumnPerson, string>;
  /**
   * 日曜・国民の祝日・振替休日など（祭日マップに該当する日を含む）で、
   * 表の行を休日色（ピンク）にする。土曜は false（土曜は別色）。
   */
  isRestDayPastelPinkRow: boolean;
  /** 管理職列に併記する、その日の部員希望（休・✖・午前半休・午後半休・夜× など） */
  preferenceMarksByColumnPerson: Record<RosterColumnPerson, string>;
}
