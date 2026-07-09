import type { ActionPermission, PermissionMeta } from "./types.ts";

/** Unified permission catalog — shared by /assist and /actions. */
export const ACTION_PERMISSIONS: Record<ActionPermission, PermissionMeta> = {
  "act:research": { label: "Look things up on the web", readonly: true, browser: false },
  "act:contact": { label: "Contact someone on your behalf", readonly: false, browser: false },
  "act:fill_forms": { label: "Fill out and submit paperwork", readonly: false, browser: true },
  "act:reserve": { label: "Make a reservation or appointment", readonly: false, browser: true },
  "act:purchase": { label: "Spend money to resolve it", readonly: false, browser: true },
  "act:browser_login": {
    label: "Sign in to a website as you (using your Vault)",
    readonly: false,
    browser: true,
    description: "Uses credentials you saved in the Vault — never stored in chat.",
  },
  "act:browser_navigate": {
    label: "Browse a logged-in page and read or act on it",
    readonly: false,
    browser: true,
  },
};

export function isValidPermission(p: string): p is ActionPermission {
  return p in ACTION_PERMISSIONS;
}
