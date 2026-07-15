import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { GoldenFixture } from "../scenarios/types.ts";

const GOLDENS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../replay/goldens");

export function loadGolden(id: string): GoldenFixture | null {
  const path = join(GOLDENS_DIR, `${id}.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as GoldenFixture;
  } catch {
    return null;
  }
}

export function goldenPath(id: string): string {
  return join(GOLDENS_DIR, `${id}.json`);
}
