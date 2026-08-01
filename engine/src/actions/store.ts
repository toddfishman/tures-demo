import { Collection } from "../db/persist.ts";
import type { ActionGrant, ActionRun, HandoffRequest } from "./types.ts";

class GrantStore {
  private col = new Collection<ActionGrant>("action_grants");
  list(accountId: string) {
    return this.col.values().filter((g) => g.accountId === accountId && g.status === "active");
  }
  get(id: string) {
    return this.col.get(id);
  }
  put(g: ActionGrant) {
    return this.col.set(g.id, g);
  }
}

class RunStore {
  private col = new Collection<ActionRun>("action_runs");
  get(id: string) {
    return this.col.get(id);
  }
  put(r: ActionRun) {
    return this.col.set(r.id, r);
  }
  list(accountId: string) {
    return this.col.values().filter((r) => r.accountId === accountId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

class HandoffStore {
  private col = new Collection<HandoffRequest>("action_handoffs");
  get(token: string) {
    return this.col.get(token);
  }
  put(h: HandoffRequest) {
    return this.col.set(h.token, h);
  }
}

let grantCounter = 0;
let runCounter = 0;

export const actionGrants = new GrantStore();
export const actionRuns = new RunStore();
export const handoffs = new HandoffStore();

export function nextGrantId() {
  return `ag_${Date.now().toString(36)}_${grantCounter++}`;
}
export function nextRunId() {
  return `ar_${Date.now().toString(36)}_${runCounter++}`;
}
export function handoffToken() {
  return `ho_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
