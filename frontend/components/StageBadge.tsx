import { STAGE_LABEL, STAGE_TONE } from "@/lib/format";

export function StageBadge({ stage }: { stage: string }) {
  const tone = STAGE_TONE[stage];
  return <span className={`pill ${tone ? `pill-${tone}` : ""}`}>{STAGE_LABEL[stage] ?? stage}</span>;
}
