import type { DutyMember } from "@/types";
import { DUTY_MEMBER_RANK_ORDER_BY_MEMBER } from "@/types";

/**
 * 当番回数の割当優先（部員向け UI・公開ルールには記載しない・努力目標）。
 *
 * `dutyCounts` は呼び出し側で「早番だけ」「遅番だけ」など枠種別ごとの回数を渡す。
 * 早番と遅番を合算した総数では比較しない。
 *
 * 1. 可能な限り当該枠種別の回数を同数に近づける（少ない人を優先）。
 * 2. 同数にできない局面では、序列下位（中嶋→…→磯田）が多くなるよう下位を優先。
 *    序列は年齢順（数値が大きいほど若い想定）。端数配分は下位優先を主とし、
 *    わずかに若手へ寄せる（部員向け説明には記載しない）。
 */
export function compareForDutyCountAssignment(
  a: DutyMember,
  b: DutyMember,
  dutyCounts: Record<DutyMember, number>,
): number {
  const ca = dutyCounts[a] ?? 0;
  const cb = dutyCounts[b] ?? 0;
  if (ca !== cb) return ca - cb;
  const ra = DUTY_MEMBER_RANK_ORDER_BY_MEMBER[a];
  const rb = DUTY_MEMBER_RANK_ORDER_BY_MEMBER[b];
  const rankSurplus = ra - rb;
  const youthNudge = rb - ra;
  return rankSurplus + youthNudge * 0.2;
}
