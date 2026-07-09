import { config } from "../config.ts";
import { log } from "../logger.ts";

export interface BrowserSession {
  sessionId: string;
  liveViewUrl: string;
  simulated?: boolean;
}

export function browserConfigured(): boolean {
  return !!(config.browserbase.apiKey && config.browserbase.projectId);
}

/** Create a Browserbase session with live view. Returns null when not configured or API fails. */
export async function createBrowserSession(targetUrl?: string): Promise<BrowserSession | null> {
  if (!browserConfigured()) return null;
  try {
    const res = await fetch("https://www.browserbase.com/v1/sessions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-BB-API-Key": config.browserbase.apiKey!,
      },
      body: JSON.stringify({
        projectId: config.browserbase.projectId,
        browserSettings: targetUrl ? { initialUrl: targetUrl } : undefined,
      }),
    });
    if (!res.ok) {
      log.warn("browserbase: session create failed", { status: res.status });
      return null;
    }
    const data = (await res.json()) as { id?: string; debuggerFullscreenUrl?: string; debuggerUrl?: string };
    if (!data.id) return null;
    return {
      sessionId: data.id,
      liveViewUrl:
        data.debuggerFullscreenUrl ||
        data.debuggerUrl ||
        `https://www.browserbase.com/sessions/${data.id}`,
    };
  } catch (e) {
    log.warn("browserbase: session error", { err: String((e as Error)?.message ?? e) });
    return null;
  }
}

/** Placeholder live view for dev/demo when Browserbase is not keyed — honest, not a fake success. */
export function simulatedSession(targetUrl?: string): BrowserSession {
  return {
    sessionId: `sim_${Date.now().toString(36)}`,
    liveViewUrl: targetUrl || "https://www.browserbase.com",
    simulated: true,
  };
}
