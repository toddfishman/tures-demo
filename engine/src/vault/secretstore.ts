// Pluggable secret storage — the seam behind the vault's connect()/reveal().
//
//   • local (default): AES-256-GCM at rest (vault/crypto). We hold ciphertext + the key.
//   • vgs: tokenize through Very Good Security. The raw value is sent to VGS, which returns an
//     alias; only the alias is stored on our side, so sensitive PII never lands in our database.
//     Reveal calls VGS to detokenize at point of use (booking time).
//
// Cards are NOT handled here — they go to Stripe (we store Stripe tokens, never card numbers).
// This store covers the rest: passport / KTN / loyalty numbers and connected-service tokens.
import { encrypt, decrypt } from "./crypto.ts";
import { config } from "../config.ts";
import { log } from "../logger.ts";

export interface SecretStore {
  readonly mode: "local" | "vgs";
  /** Persist a sensitive value; returns the token to store in place of it. */
  store(plaintext: string): Promise<string>;
  /** Resolve a stored token back to the original value. */
  reveal(token: string): Promise<string>;
}

class LocalSecretStore implements SecretStore {
  readonly mode = "local" as const;
  async store(plaintext: string): Promise<string> {
    return encrypt(plaintext);
  }
  async reveal(token: string): Promise<string> {
    return decrypt(token);
  }
}

// VGS Vault API: POST /aliases to tokenize, GET /aliases/{alias} to reveal. Basic auth with the
// vault's API access credentials. https://www.verygoodsecurity.com/docs/api/vault
class VgsSecretStore implements SecretStore {
  readonly mode = "vgs" as const;
  // We tag our alias so a VGS-stored value is distinguishable from a legacy AES blob.
  private static PREFIX = "vgs:";

  private auth(): string {
    return "Basic " + Buffer.from(`${config.vgs.username}:${config.vgs.password}`).toString("base64");
  }

  async store(plaintext: string): Promise<string> {
    const res = await fetch(`${config.vgs.url}/aliases`, {
      method: "POST",
      headers: { Authorization: this.auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ data: [{ value: plaintext, classifiers: ["pii"], format: "UUID" }] }),
    });
    if (!res.ok) throw new Error(`vgs store ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json: any = await res.json();
    const alias = json?.data?.[0]?.aliases?.[0]?.alias;
    if (!alias) throw new Error("vgs store: no alias in response");
    return VgsSecretStore.PREFIX + alias;
  }

  async reveal(token: string): Promise<string> {
    // Back-compat: a value stored before VGS was enabled is still an AES blob — decrypt locally.
    if (!token.startsWith(VgsSecretStore.PREFIX)) return decrypt(token);
    const alias = token.slice(VgsSecretStore.PREFIX.length);
    const res = await fetch(`${config.vgs.url}/aliases/${encodeURIComponent(alias)}`, {
      headers: { Authorization: this.auth() },
    });
    if (!res.ok) throw new Error(`vgs reveal ${res.status}`);
    const json: any = await res.json();
    const value = json?.data?.[0]?.value;
    if (value === undefined) throw new Error("vgs reveal: no value in response");
    return value;
  }
}

let _store: SecretStore | null = null;
export function secretStore(): SecretStore {
  if (!_store) {
    _store = config.vgs.enabled ? new VgsSecretStore() : new LocalSecretStore();
    log.info("vault: secret store", { mode: _store.mode });
  }
  return _store;
}
