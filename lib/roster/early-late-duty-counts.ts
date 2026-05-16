import type { DutyMember } from "@/types";
import { DUTY_MEMBER_RANK_ORDER_BY_MEMBER } from "@/types";

/** 期間内の早番・遅番回数（互いに合算しない） */
export interface EarlyLateDutyCounts {
  early: Record<DutyMember, number>;
  late: Record<DutyMember, number>;
}

const DUTY_MEMBERS: DutyMember[] = (
  Object.keys(DUTY_MEMBER_RANK_ORDER_BY_MEMBER) as DutyMember[]
).sort(
  (a, b) => DUTY_MEMBER_RANK_ORDER_BY_MEMBER[a] - DUTY_MEMBER_RANK_ORDER_BY_MEMBER[b],
);

export function createEarlyLateDutyCounts(): EarlyLateDutyCounts {
  const early = {} as Record<DutyMember, number>;
  const late = {} as Record<DutyMember, number>;
  for (const m of DUTY_MEMBERS) {
    early[m] = 0;
    late[m] = 0;
  }
  return { early, late };
}

export function recordEarlyLateDutyAssignment(
  counts: EarlyLateDutyCounts,
  member: DutyMember,
  kind: "早番" | "遅番",
): void {
  if (kind === "早番") {
    counts.early[member] = (counts.early[member] ?? 0) + 1;
  } else {
    counts.late[member] = (counts.late[member] ?? 0) + 1;
  }
}

export function countsForSlotKind(
  counts: EarlyLateDutyCounts,
  kind: "早番" | "遅番",
): Record<DutyMember, number> {
  return kind === "早番" ? counts.early : counts.late;
}
