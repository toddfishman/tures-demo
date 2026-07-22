import type { ActionPermission, PermissionMeta } from "./types.ts";
import { config } from "../config.ts";

/** Unified permission catalog — shared by /assist and /actions.
 *
 *  `estUsd` is our own estimate of what one run costs to serve. It decides what an anonymous
 *  visitor may run for free: a web-search lookup is a couple of cents, while anything that boots
 *  a browser session is an order of magnitude more. These are estimates, not billing truth —
 *  revise them when real provider costs are known. */
export const ACTION_PERMISSIONS: Record<ActionPermission, PermissionMeta> = {
  "act:research": { label: "Look things up on the web", readonly: true, browser: false, estUsd: 0.02 },
  "act:contact": { label: "Contact someone on your behalf", readonly: false, browser: false, estUsd: 0.02 },
  "act:fill_forms": { label: "Fill out and submit paperwork", readonly: false, browser: true, estUsd: 0.35 },
  "act:reserve": { label: "Make a reservation or appointment", readonly: false, browser: true, estUsd: 0.35 },
  "act:purchase": { label: "Spend money to resolve it", readonly: false, browser: true, estUsd: 0.35 },
  "act:browser_login": {
    label: "Sign in to a website as you (using your Vault)",
    readonly: false,
    browser: true,
    estUsd: 0.35,
    description: "Uses credentials you saved in the Vault — never stored in chat.",
  },
  "act:browser_navigate": {
    label: "Browse a logged-in page and read or act on it",
    readonly: false,
    browser: true,
    estUsd: 0.25,
  },
};

export function isValidPermission(p: string): p is ActionPermission {
  return p in ACTION_PERMISSIONS;
}

/** May an ANONYMOUS visitor run this action, on us? Three conditions, all required:
 *   • read-only — it only looks things up; it never acts as, contacts, or spends for anyone
 *   • no browser session — nothing that logs in or operates a site on someone's behalf
 *   • cheap — at or under the free-run ceiling (FREE_ACTION_MAX_USD, default $0.05)
 *  Default-deny: anything not clearly all three needs an account. */
export function freeForAnonymous(permission: string): { allowed: boolean; reason?: string } {
  if (!isValidPermission(permission)) return { allowed: false, reason: "unknown action" };
  const meta = ACTION_PERMISSIONS[permission];
  if (!meta.readonly) return { allowed: false, reason: "this one acts on your behalf, so it needs an account" };
  if (meta.browser) return { allowed: false, reason: "this one drives a browser as you, so it needs an account" };
  if (meta.estUsd > config.freeActionMaxUsd) {
    return { allowed: false, reason: "this lookup costs more than we run for free" };
  }
  return { allowed: true };
}
