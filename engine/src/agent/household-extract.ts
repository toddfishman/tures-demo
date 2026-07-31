// Household extractor — spots the people in a trip so Tures can OFFER to remember them.
// Deterministic + heuristic on purpose: it only ever PROPOSES ("Remember Sam (10) & Ben (8)?"),
// and nothing is stored until the user confirms (routes/household.ts → addTraveler). A missed
// name here just means Tures asks the normal way; a false positive is one tap to dismiss. An
// LLM extractor can replace this later without changing the confirm contract.

export interface HouseholdProposal {
  relationship: "spouse" | "partner" | "child" | "parent" | "companion";
  age?: number; // children only, when stated
  label: string; // human-friendly, for the confirm chip: "your spouse", "a 10-year-old"
}

const NUM_WORD: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};
const KID_NOUN = "(?:kids?|children|sons?|daughters?|boys?|girls?)";

/** Return zero or more people mentioned in `text`, to be surfaced as confirm chips. */
export function extractHousehold(text: string): HouseholdProposal[] {
  const raw = (text || "").toLowerCase().replace(/[–—]/g, "-");
  const t = ` ${raw} `;
  const out: HouseholdProposal[] = [];

  // --- adults by relationship keyword (one each) ---
  const relMap: Array<[RegExp, HouseholdProposal["relationship"], string]> = [
    [/\b(wife|husband|spouse)\b/, "spouse", "your spouse"],
    [/\b(partner|girlfriend|boyfriend|fiance|fiancee|fiancé|fiancée)\b/, "partner", "your partner"],
    [/(\bmother\b|\bfather\b|\bmom\b|\bdad\b)/, "parent", "your parent"],
  ];
  const seen = new Set<string>();
  for (const [re, relationship, label] of relMap) {
    if (re.test(t) && !seen.has(relationship)) {
      seen.add(relationship);
      out.push({ relationship, label });
    }
  }

  // --- children: a count and/or explicit ages ---
  let count = 0;
  const countRe = new RegExp(`\\b(\\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\\s+${KID_NOUN}`, "i");
  const cm = countRe.exec(raw);
  if (cm) {
    const g = cm[1] ?? "";
    count = /^\d+$/.test(g) ? Number(g) : NUM_WORD[g] ?? 0;
  }

  const ages: number[] = [];
  const pushAge = (n: number) => {
    if (n >= 0 && n <= 17) ages.push(n);
  };
  let m: RegExpExecArray | null;
  // "6 year old", "6-year-old", "6 yr old"
  const yo = /\b(\d{1,2})\s*[- ]?\s*(?:year|yr)s?\s*[- ]?\s*old\b/g;
  while ((m = yo.exec(raw))) pushAge(Number(m[1]));
  // "ages 10 and 8", "aged 5, 7"
  const agesPhrase = /\bage[ds]?\b[:\s]*([\d,\s]+(?:and\s*\d+)?)/g;
  while ((m = agesPhrase.exec(raw))) for (const n of (m[1] ?? "").match(/\d{1,2}/g) ?? []) pushAge(Number(n));
  // "two boys, 10 and 8" — ages listed right after the "<count> <kid noun>" phrase
  if (cm && ages.length === 0) {
    const after = raw.slice(cm.index + cm[0].length, cm.index + cm[0].length + 40);
    for (const n of after.match(/\b\d{1,2}\b/g) ?? []) pushAge(Number(n));
  }

  const nKids = Math.max(count, ages.length);
  for (let i = 0; i < nKids; i++) {
    const age = ages[i];
    out.push({ relationship: "child", age, label: age !== undefined ? `a ${age}-year-old` : "a child" });
  }
  return out;
}
