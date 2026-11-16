import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const VERSION = 1;
const NONCE_LEN = 12;
const TAG_LEN = 16;

// ---------------------------------------------------------------- encryption

function encryptionKey(keyBase64: string): Buffer {
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== 32) {
    throw new Error("ENCRYPTION_KEY must decode to exactly 32 bytes (base64 of 32 bytes)");
  }
  return key;
}

/**
 * AES-256-GCM. Layout: [version:1][nonce:12][tag:16][ciphertext…]
 * Stored as VARBINARY so no charset conversion can ever corrupt the bytes.
 */
export function encryptSecret(keyBase64: string, plaintext: string): Buffer {
  const key = encryptionKey(keyBase64);
  const nonce = randomBytes(NONCE_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([VERSION]), nonce, tag, ciphertext]);
}

export function decryptSecret(keyBase64: string, blob: Buffer): string {
  if (blob.length < 1 + NONCE_LEN + TAG_LEN) {
    throw new Error("ciphertext too short");
  }
  const version = blob[0];
  if (version !== VERSION) {
    throw new Error(`unsupported ciphertext version: ${version}`);
  }
  const key = encryptionKey(keyBase64);
  const nonce = blob.subarray(1, 1 + NONCE_LEN);
  const tag = blob.subarray(1 + NONCE_LEN, 1 + NONCE_LEN + TAG_LEN);
  const ciphertext = blob.subarray(1 + NONCE_LEN + TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

// -------------------------------------------------------------------- base32

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/[\s-]/g, "").replace(/=+$/g, "").toUpperCase();
  if (clean.length === 0) {
    throw new Error("empty base32 input");
  }
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = B32.indexOf(char);
    if (index === -1) {
      throw new Error(`invalid base32 character: ${char}`);
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += B32[(value << (5 - bits)) & 31];
  }
  return out;
}

// ----------------------------------------------------------------------- totp

export type TotpAlgorithm = "SHA1" | "SHA256" | "SHA512";

export interface TotpOptions {
  algorithm?: TotpAlgorithm;
  digits?: number;
  period?: number;
}

function normalize(options: TotpOptions = {}) {
  const algorithm: TotpAlgorithm = options.algorithm ?? "SHA1";
  const digits = options.digits ?? 6;
  const period = options.period ?? 30;
  if (![6, 8].includes(digits)) {
    throw new Error("digits must be 6 or 8");
  }
  if (period < 10 || period > 300) {
    throw new Error("period out of range");
  }
  return { algorithm, digits, period };
}

function hotp(secret: Buffer, counter: number, digits: number, algorithm: TotpAlgorithm): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter), 0);
  const digest = createHmac(algorithm.toLowerCase().replace("sha", "sha"), secret)
    .update(message)
    .digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  return String(binary % 10 ** digits).padStart(digits, "0");
}

export interface TotpResult {
  code: string;
  counter: number;
  remaining: number;
  period: number;
  digits: number;
}

/**
 * Codes are generated on the server only. The raw secret never reaches a browser.
 */
export function generateTotp(
  secretBase32: string,
  options: TotpOptions = {},
  atEpochSeconds = Math.floor(Date.now() / 1000),
): TotpResult {
  const { algorithm, digits, period } = normalize(options);
  const counter = Math.floor(atEpochSeconds / period);
  const code = hotp(base32Decode(secretBase32), counter, digits, algorithm);
  const remaining = period - (atEpochSeconds % period);
  return { code, counter, remaining, period, digits };
}

export function verifyTotp(
  secretBase32: string,
  candidate: string,
  options: TotpOptions & { window?: number } = {},
  atEpochSeconds = Math.floor(Date.now() / 1000),
): boolean {
  const { algorithm, digits, period } = normalize(options);
  const window = options.window ?? 1;
  const normalized = candidate.replace(/\s/g, "");
  if (!/^\d+$/.test(normalized)) {
    return false;
  }
  const secret = base32Decode(secretBase32);
  const current = Math.floor(atEpochSeconds / period);
  for (let drift = -window; drift <= window; drift += 1) {
    const expected = hotp(secret, current + drift, digits, algorithm);
    if (safeEqual(expected, normalized)) {
      return true;
    }
  }
  return false;
}

export function generateSecret(bytes = 20): string {
  return base32Encode(randomBytes(bytes));
}

// -------------------------------------------------------------- otpauth uris

export interface OtpauthData {
  label: string;
  issuer: string;
  account: string;
  secret: string;
  algorithm: TotpAlgorithm;
  digits: number;
  period: number;
}

export function buildOtpauthUri(data: OtpauthData): string {
  const issuer = data.issuer.trim();
  const account = data.account.trim();
  const label = issuer ? `${issuer}:${account}` : account;
  const params = new URLSearchParams({
    secret: data.secret,
    algorithm: data.algorithm,
    digits: String(data.digits),
    period: String(data.period),
  });
  if (issuer) {
    params.set("issuer", issuer);
  }
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}

/** Accepts otpauth://totp/... as pasted or as decoded from a QR code. */
export function parseOtpauthUri(uri: string): OtpauthData {
  const trimmed = uri.trim();
  if (!trimmed.toLowerCase().startsWith("otpauth://")) {
    throw new Error("bukan URI otpauth");
  }
  const url = new URL(trimmed);
  if (url.host.toLowerCase() !== "totp") {
    throw new Error("hanya otpauth TOTP yang didukung");
  }
  const secret = (url.searchParams.get("secret") ?? "").replace(/\s/g, "").toUpperCase();
  if (!/^[A-Z2-7]+=*$/.test(secret) || secret.length < 8) {
    throw new Error("secret base32 tidak valid");
  }
  // Round-trip through the decoder: catches bad padding and stray digits early.
  base32Decode(secret);

  const rawLabel = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const issuerParam = url.searchParams.get("issuer") ?? "";
  const splitLabel = rawLabel.includes(":") ? rawLabel.split(":") : [issuerParam, rawLabel];
  const issuer = (issuerParam || splitLabel[0] || "").trim();
  const account = (splitLabel.length > 1 ? splitLabel.slice(1).join(":") : rawLabel).trim();

  const algorithmRaw = (url.searchParams.get("algorithm") ?? "SHA1").toUpperCase();
  const algorithm: TotpAlgorithm =
    algorithmRaw === "SHA256" || algorithmRaw === "SHA512" ? algorithmRaw : "SHA1";
  const digits = Number(url.searchParams.get("digits") ?? "6") === 8 ? 8 : 6;
  const periodRaw = Number(url.searchParams.get("period") ?? "30");
  const period = Number.isFinite(periodRaw) && periodRaw >= 10 && periodRaw <= 300 ? periodRaw : 30;

  return { label: rawLabel, issuer, account, secret, algorithm, digits, period };
}

// ------------------------------------------------------------------- sessions

export function newSessionToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: sha256Hex(token) };
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Keyed fingerprint of a secret, scoped to one user.
 *
 * Two properties matter here:
 *  - keyed: a stolen database cannot be checked against lists of well-known seeds.
 *  - scoped: the same secret stored by two accounts yields different fingerprints,
 *    so reading the table cannot reveal that two users share a seed.
 */
export function secretFingerprint(keyBase64: string, userId: number, secret: string): string {
  return createHmac("sha256", encryptionKey(keyBase64))
    .update(`fa:fp:v2:${userId}:`)
    .update(secret)
    .digest("hex");
}

/**
 * Identity of an entry: the account it belongs to, ignoring the secret. Two
 * separate accounts (different label/issuer/account) may legitimately share one
 * TOTP seed, so uniqueness is scoped by identity as well as by secret.
 */
export function entryIdentity(label: string, issuer: string, account: string): string {
  return createHash("sha256")
    .update([label, issuer, account].map((value) => value.trim().toLowerCase()).join("\u0000"))
    .digest("hex");
}

/** Dedupe key = secret fingerprint + entry identity. */
export function entryDedupeKey(fingerprint: string, identity: string): string {
  return `${fingerprint}:${identity}`;
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}
