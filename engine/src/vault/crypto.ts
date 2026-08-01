// Authenticated encryption for credentials at rest (AES-256-GCM). The vault never stores a raw
// token/card — only the ciphertext produced here. Key comes from VAULT_KEY (hex or base64, 32
// bytes); without it we generate an ephemeral per-process key so dev runs keyless (secrets just
// don't survive a restart — which is correct for dev).
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { config } from "../config.ts";
import { log } from "../logger.ts";

function loadKey(): Buffer {
  if (config.vaultKey) {
    const raw = /^[0-9a-fA-F]{64}$/.test(config.vaultKey)
      ? Buffer.from(config.vaultKey, "hex")
      : Buffer.from(config.vaultKey, "base64");
    if (raw.length === 32) return raw;
    log.warn("VAULT_KEY is not 32 bytes after decode — using an ephemeral key instead");
  }
  log.warn("no valid VAULT_KEY set — using an ephemeral key (vault secrets won't survive restart)");
  return randomBytes(32);
}

const KEY = loadKey();

/** Returns base64(iv ‖ authTag ‖ ciphertext). */
export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

export function decrypt(blob: string): string {
  const buf = Buffer.from(blob, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
