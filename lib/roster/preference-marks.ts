import type { MemberDayPreferenceFlags } from "@/types";

/** 当番表プレビュー・CSV 併記用の希望記号（短い表記） */
export function formatPreferenceMarksForDay(flags: MemberDayPreferenceFlags): string {
  const parts: string[] = [];
  if (flags.fullDayOff) parts.push("休");
  if (flags.fullyUnavailable) parts.push("✖");
  if (flags.morningHalfOff) parts.push("午前半休");
  if (flags.afternoonHalfOff) parts.push("午後半休");
  if (flags.nightUnavailable) parts.push("夜×");
  return parts.join("・");
}
