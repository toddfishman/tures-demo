/** Load versioned agent prompts from engine/playbooks/*.md (cached at first read). */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PLAYBOOKS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../playbooks");
const cache = new Map<string, string>();

export function loadPlaybook(name: string, vars?: Record<string, string>): string {
  const cacheKey = vars ? `${name}:${JSON.stringify(vars)}` : name;
  if (cache.has(cacheKey)) return cache.get(cacheKey)!;

  const path = join(PLAYBOOKS_DIR, `${name}.md`);
  let text = readFileSync(path, "utf8").trim();
  if (vars) {
    for (const [key, value] of Object.entries(vars)) {
      text = text.replaceAll(`{{${key}}}`, value);
    }
  }
  cache.set(cacheKey, text);
  return text;
}

/** Clear cached playbooks — for tests that swap prompt files. */
export function clearPlaybookCache(): void {
  cache.clear();
}
