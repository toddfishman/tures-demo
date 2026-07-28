// Marketing store — durable when DATA_DIR is set (see db/persist), in-memory otherwise. Same
// shape as the booking store so campaigns survive restarts and the scheduler can pick up a
// running campaign after a deploy.
import type { Campaign } from "./types.ts";
import { Collection } from "../db/persist.ts";

class CampaignStore {
  private byId = new Collection<Campaign>("campaigns");

  get(id: string): Campaign | undefined {
    return this.byId.get(id);
  }

  /** Campaigns for an account, newest first — the growth dashboard's list. */
  listByAccount(accountId: string): Campaign[] {
    return this.byId
      .values()
      .filter((c) => c.accountId === accountId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** The scheduler's worklist: campaigns actively running the loop. */
  running(): Campaign[] {
    return this.byId.values().filter((c) => c.status === "running");
  }

  put(c: Campaign): Campaign {
    c.updatedAt = new Date().toISOString();
    this.byId.set(c.id, c);
    return c;
  }
}

export const campaigns = new CampaignStore();

let counter = 0;
export function nextCampaignId(): string {
  return `mk_${Date.now().toString(36)}_${counter++}`;
}

let creativeCounter = 0;
export function nextCreativeId(): string {
  return `cr_${Date.now().toString(36)}_${creativeCounter++}`;
}
