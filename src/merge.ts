import { MergeInput, MergeResult } from "./types.js";

export function evaluateMergeReadiness(input: MergeInput): MergeResult {
  const reasons: string[] = [];
  if (input.draft) reasons.push("pull request is draft");
  if (input.mergeable === false) reasons.push("pull request has conflicts");
  if (!input.baseMatches) reasons.push("base branch changed");
  for (const check of input.checks) {
    if (check.conclusion === "failure" || check.conclusion === "cancelled" || check.conclusion === "timed_out") reasons.push(`${check.name} failed`);
    else if (check.conclusion !== "success" && check.conclusion !== "neutral" && check.conclusion !== "skipped") reasons.push(`${check.name} is ${check.conclusion ?? "pending"}`);
  }
  const approvalsNeeded = Math.max(0, input.approvals.required - input.approvals.current);
  if (approvalsNeeded > 0) reasons.push(`needs ${approvalsNeeded} approval(s)`);

  if (input.mergeable === null) return { status: "unknown", reasons: reasons.length ? reasons : ["GitHub has not calculated mergeability"] };
  if (reasons.some((reason) => reason.includes("conflicts"))) return { status: "conflicted", reasons };
  if (reasons.some((reason) => reason.includes("pending") || reason.includes("queued") || reason.includes("in_progress"))) return { status: "pending_checks", reasons };
  if (reasons.length > 0) return { status: "blocked", reasons };
  return { status: "ready", reasons: [] };
}
