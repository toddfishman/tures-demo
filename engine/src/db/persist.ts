// Durable persistence — a tiny synchronous, file-backed key/value collection.
//
// Why this shape: the whole engine is synchronous (vault.hasScope, policy checks, etc.), so a
// sync store keeps the code simple and avoids an async refactor. When DATA_DIR is set, each
// collection is written through to a JSON file (atomic temp+rename) and loaded on boot — so
// accounts/vault/bookings survive restarts. Without DATA_DIR it's pure in-memory (dev/tests).
//
// Scale path: for multi-machine or large volume, swap this for Postgres/Redis behind the same
// Collection API. NOTE: secrets are encrypted BEFORE they reach here (see vault/crypto), so what
// lands on disk is ciphertext, never plaintext PII.
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { config } from "../config.ts";
import { log } from "../logger.ts";

const DIR = config.dataDir;

function fileFor(name: string) {
  return `${DIR}/${name}.json`;
}

export class Collection<T> {
  private map = new Map<string, T>();

  constructor(private name: string) {
    if (!DIR) return;
    try {
      const raw = readFileSync(fileFor(name), "utf8");
      for (const [k, v] of JSON.parse(raw) as [string, T][]) this.map.set(k, v);
      log.info("persist: loaded", { name, count: this.map.size });
    } catch {
      // first run / missing file — start empty
    }
  }

  get(key: string): T | undefined {
    return this.map.get(key);
  }
  has(key: string): boolean {
    return this.map.has(key);
  }
  set(key: string, value: T): T {
    this.map.set(key, value);
    this.flush();
    return value;
  }
  delete(key: string): void {
    this.map.delete(key);
    this.flush();
  }
  values(): T[] {
    return [...this.map.values()];
  }

  private flush() {
    if (!DIR) return;
    try {
      mkdirSync(DIR, { recursive: true });
      const tmp = fileFor(this.name) + ".tmp";
      writeFileSync(tmp, JSON.stringify([...this.map.entries()]));
      renameSync(tmp, fileFor(this.name));
    } catch (e) {
      log.error("persist: flush failed", { name: this.name, err: String(e) });
    }
  }
}
