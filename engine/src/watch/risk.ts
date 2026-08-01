// Risk scorer — turns fast signals + urgency into today's adaptive scan budget.
import type { Signal } from "../signals/types.ts";
import type { RiskLevel } from "./types.ts";

const SEV = { critical: 40, warning: 22, watch: 10, info: 3 };

export interface RiskAssessment {
  score: number;
  level: RiskLevel;
  scansBudget: number;
  allowDeep: boolean;
  reasons: string[];
}

export function daysUntilDepart(departDate?: string): number | null {
  if (!departDate) return null;
  const d = Date.parse(departDate + "T12:00:00Z");
  if (isNaN(d)) return null;
  return Math.ceil((d - Date.now()) / 86400000);
}

/** Score 0–100 from fast signals + days until departure. Drives scan schedule. */
export function assessRisk(signals: Signal[], departDate?: string): RiskAssessment {
  let score = 0;
  const reasons: string[] = [];

  for (const s of signals) {
    score += SEV[s.severity] ?? 0;
    if (s.travelImpacting && (s.severity === "warning" || s.severity === "critical")) {
      reasons.push(s.title);
    }
  }

  const days = daysUntilDepart(departDate);
  if (days != null) {
    if (days <= 1) {
      score += 25;
      reasons.push("departure within 24h");
    } else if (days <= 3) {
      score += 18;
      reasons.push("departure within 3 days");
    } else if (days <= 7) {
      score += 10;
    } else if (days <= 14) {
      score += 4;
    }
  }

  score = Math.min(100, score);
  let level: RiskLevel = "clear";
  if (score >= 76) level = "critical";
  else if (score >= 51) level = "elevated";
  else if (score >= 21) level = "watch";

  let scansBudget = 0;
  if (level === "watch") scansBudget = 1;
  else if (level === "elevated") scansBudget = 2;
  else if (level === "critical") scansBudget = 3;

  const allowDeep = level === "critical" || level === "elevated" || score >= 40;

  return { score, level, scansBudget, allowDeep, reasons: reasons.slice(0, 4) };
}

export function scansBudgetForLevel(level: RiskLevel): number {
  if (level === "watch") return 1;
  if (level === "elevated") return 2;
  if (level === "critical") return 3;
  return 0;
}
