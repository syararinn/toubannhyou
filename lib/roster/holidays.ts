import type { AdminSettings, ISODateString } from "@/types";

/**
 * 2026 年の国民の祝日・祝日法に基づく休日（振替等を含む簡易セット）。
 * 出典: 内閣府「国民の祝日について」 https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html
 */
export const JP_HOLIDAYS_2026: Record<ISODateString, string> = {
  "2026-01-01": "元日",
  "2026-01-12": "成人の日",
  "2026-02-11": "建国記念の日",
  "2026-02-23": "天皇誕生日",
  "2026-03-20": "春分の日",
  "2026-04-29": "昭和の日",
  "2026-05-03": "憲法記念日",
  "2026-05-04": "みどりの日",
  "2026-05-05": "こどもの日",
  "2026-05-06": "振替休日",
  "2026-07-20": "海の日",
  "2026-08-11": "山の日",
  "2026-09-21": "敬老の日",
  "2026-09-22": "休日",
  "2026-09-23": "秋分の日",
  "2026-10-12": "スポーツの日",
  "2026-11-03": "文化の日",
  "2026-11-23": "勤労感謝の日",
};

/** 令和9年（2027年）分。未収載の年は `nationalHolidaysManual` で補完する。 */
export const JP_HOLIDAYS_2027: Record<ISODateString, string> = {
  "2027-01-01": "元日",
  "2027-01-11": "成人の日",
  "2027-02-11": "建国記念の日",
  "2027-02-23": "天皇誕生日",
  "2027-03-21": "春分の日",
  "2027-03-22": "休日",
  "2027-04-29": "昭和の日",
  "2027-05-03": "憲法記念日",
  "2027-05-04": "みどりの日",
  "2027-05-05": "こどもの日",
  "2027-07-19": "海の日",
  "2027-08-11": "山の日",
  "2027-09-20": "敬老の日",
  "2027-09-23": "秋分の日",
  "2027-10-11": "スポーツの日",
  "2027-11-03": "文化の日",
  "2027-11-23": "勤労感謝の日",
};

/** アプリ同梱の祝日・休日（上記ページの表に基づく）。 */
export const JP_HOLIDAYS_EMBEDDED: Record<ISODateString, string> = {
  ...JP_HOLIDAYS_2026,
  ...JP_HOLIDAYS_2027,
};

/**
 * 祝日名の解決用マップを組み立てる。
 * 優先順位: `holidaysExtra`（生成時オプション） > 管理者手動 > 同梱データ。
 */
export function buildHolidayLookupMap(
  admin: AdminSettings,
  runtimeExtra?: Record<ISODateString, string>,
): Record<ISODateString, string> {
  const manual: Record<string, string> = {};
  for (const e of admin.nationalHolidaysManual) {
    if (!e || typeof e.date !== "string" || typeof e.name !== "string") continue;
    const d = e.date.trim();
    const n = e.name.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !n) continue;
    manual[d] = n;
  }
  return { ...JP_HOLIDAYS_EMBEDDED, ...manual, ...(runtimeExtra ?? {}) };
}

/**
 * その日の祝日・休日（法による休日）の表示名。見つからなければ空文字。
 * `holidayMap` は `buildHolidayLookupMap` の戻り値など、参照すべき日付がすべて載ったマップを渡す。
 */
export function holidayNameOn(
  iso: ISODateString,
  holidayMap: Record<ISODateString, string>,
): string {
  return holidayMap[iso] ?? "";
}

export function isSundayOrNationalHoliday(
  iso: ISODateString,
  holidayMap: Record<ISODateString, string>,
): boolean {
  const [y, m, d] = iso.split("-").map(Number);
  const sun0 = new Date(y, m - 1, d).getDay();
  if (sun0 === 0) return true;
  return Boolean(holidayNameOn(iso, holidayMap));
}
