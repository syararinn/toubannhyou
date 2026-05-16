import type { PreferenceLimitApplication } from "@/types";

/** 部員が記載した理由から、どちらの上限追加を求めているか（管理画面用） */
export function applicationKindSummary(app: PreferenceLimitApplication): {
  restCross: boolean;
  night: boolean;
  shortLabel: string;
} {
  const rest = app.restCrossReason.trim().length > 0;
  const night = app.nightReason.trim().length > 0;
  if (rest && night) {
    return { restCross: true, night: true, shortLabel: "休・✖・夜✖" };
  }
  if (rest) {
    return { restCross: true, night: false, shortLabel: "休・✖" };
  }
  if (night) {
    return { restCross: false, night: true, shortLabel: "夜✖" };
  }
  return {
    restCross: false,
    night: false,
    shortLabel: "（理由文から区分不明）",
  };
}
