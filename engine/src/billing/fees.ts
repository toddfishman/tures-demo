// Server-derived pricing — never trust fee amounts from the client.
import { getUser } from "../auth/index.ts";
import { config } from "../config.ts";

/** Per-trip concierge fee. Subscribers pay $0; anonymous/demo previews are never fee'd. */
export function perTripFee(accountId: string): number {
  const user = getUser(accountId);
  if (!user || user.plan === "subscribe") return 0;
  return config.perTripFeeUsd;
}
