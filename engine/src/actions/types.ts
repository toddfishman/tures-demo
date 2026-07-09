// Action Executor — permissions, runs, and human handoff.

export type ActionPermission =
  | "act:research"
  | "act:contact"
  | "act:fill_forms"
  | "act:reserve"
  | "act:purchase"
  | "act:browser_login"
  | "act:browser_navigate";

export interface PermissionMeta {
  label: string;
  readonly: boolean;
  browser: boolean;
  description?: string;
}

export type ActionRunStatus =
  | "proposed"
  | "granted"
  | "running"
  | "needs_human"
  | "completed"
  | "failed"
  | "aborted";

export interface ActionGrant {
  id: string;
  accountId: string;
  permission: ActionPermission;
  label: string;
  /** Optional scope: domain, tripId, maxUsd */
  scope?: { domain?: string; tripId?: string; maxUsd?: number; expiresAt?: string };
  status: "active" | "revoked";
  createdAt: string;
  revokedAt?: string;
}

export interface ActionRun {
  id: string;
  accountId: string;
  tripId?: string;
  grantId: string;
  permission: ActionPermission;
  title: string;
  detail?: string;
  targetUrl?: string;
  status: ActionRunStatus;
  /** Browserbase session id when wired */
  browserSessionId?: string;
  liveViewUrl?: string;
  handoffToken?: string;
  result?: { summary?: string; simulated?: boolean; agentMessage?: string; sessionUrl?: string };
  audit: Array<{ ts: string; action: string; detail?: string }>;
  createdAt: string;
  updatedAt: string;
}

export interface HandoffRequest {
  token: string;
  runId: string;
  accountId: string;
  reason: "captcha" | "otp" | "login" | "confirm" | "other";
  title: string;
  instructions: string;
  liveViewUrl?: string;
  targetUrl?: string;
  status: "open" | "continued" | "aborted" | "expired";
  expiresAt: string;
  createdAt: string;
}
