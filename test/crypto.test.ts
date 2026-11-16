import { describe, expect, test } from "bun:test";
import {
  base32Decode,
  base32Encode,
  buildOtpauthUri,
  decryptSecret,
  encryptSecret,
  secretFingerprint,
  generateTotp,
  parseOtpauthUri,
  verifyTotp,
} from "../src/crypto.ts";

// RFC 6238 appendix B, SHA1 vectors (8 digits).
const RFC_SECRET_ASCII = "12345678901234567890";
const RFC_SECRET = base32Encode(Buffer.from(RFC_SECRET_ASCII, "ascii"));
const RFC_VECTORS: Array<[number, string]> = [
  [59, "94287082"],
  [1111111109, "07081804"],
  [1111111111, "14050471"],
  [1234567890, "89005924"],
  [2000000000, "69279037"],
  [20000000000, "65353130"],
];

describe("base32", () => {
  test("encodes the RFC seed to the well known value", () => {
    expect(RFC_SECRET).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  });

  test("round trips arbitrary bytes", () => {
    const raw = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect(base32Decode(base32Encode(raw)).equals(raw)).toBe(true);
  });

  test("tolerates lowercase, spaces and padding", () => {
    const half = base32Decode("gezd gnbv gy3t qojq====");
    expect(half.equals(Buffer.from("1234567890", "ascii"))).toBe(true);
    expect(base32Decode(RFC_SECRET.toLowerCase()).equals(Buffer.from(RFC_SECRET_ASCII))).toBe(true);
  });

  test("rejects characters outside the alphabet", () => {
    expect(() => base32Decode("GEZD1NBV")).toThrow();
  });
});

describe("totp", () => {
  test.each(RFC_VECTORS)("matches RFC 6238 at T=%d", (time, expected) => {
    expect(generateTotp(RFC_SECRET, { digits: 8 }, time).code).toBe(expected);
  });

  test("reports the remaining seconds inside the current window", () => {
    const result = generateTotp(RFC_SECRET, {}, 59);
    expect(result.remaining).toBe(1); // 59 % 30 = 29, so 1s left
    expect(result.period).toBe(30);
  });

  test("accepts the previous step inside the verification window", () => {
    const previous = generateTotp(RFC_SECRET, {}, 1000).code;
    expect(verifyTotp(RFC_SECRET, previous, { window: 1 }, 1000 + 30)).toBe(true);
    expect(verifyTotp(RFC_SECRET, previous, { window: 0 }, 1000 + 90)).toBe(false);
  });

  test("rejects malformed codes", () => {
    expect(verifyTotp(RFC_SECRET, "abcdef")).toBe(false);
    expect(verifyTotp(RFC_SECRET, "12345")).toBe(false);
  });
});

describe("secret encryption", () => {
  const key = Buffer.alloc(32, 7).toString("base64");

  test("round trips and never leaks the plaintext", () => {
    const blob = encryptSecret(key, "JBSWY3DPEHPK3PXP");
    expect(blob.toString("utf8")).not.toContain("JBSWY3DPEHPK3PXP");
    expect(decryptSecret(key, blob)).toBe("JBSWY3DPEHPK3PXP");
  });

  test("uses a fresh nonce per call", () => {
    const a = encryptSecret(key, "SAME");
    const b = encryptSecret(key, "SAME");
    expect(a.equals(b)).toBe(false);
  });

  test("detects tampering via the GCM tag", () => {
    const blob = encryptSecret(key, "JBSWY3DPEHPK3PXP");
    blob[blob.length - 1] = blob[blob.length - 1]! ^ 0xff;
    expect(() => decryptSecret(key, blob)).toThrow();
  });

  test("fingerprints the same secret differently per user", () => {
    const a = secretFingerprint(key, 1, "JBSWY3DPEHPK3PXP");
    const b = secretFingerprint(key, 2, "JBSWY3DPEHPK3PXP");
    expect(a).toHaveLength(64);
    expect(a).not.toBe(b);
    // Stable for the same owner, so duplicate detection keeps working.
    expect(secretFingerprint(key, 1, "JBSWY3DPEHPK3PXP")).toBe(a);
    // Never the raw secret or a plain hash of it.
    expect(a).not.toContain("JBSWY3DPEHPK3PXP");
  });

  test("rejects a key of the wrong length", () => {
    expect(() => encryptSecret(Buffer.alloc(16).toString("base64"), "x")).toThrow();
  });
});

describe("otpauth", () => {
  test("parses a standard Google Authenticator URI", () => {
    const parsed = parseOtpauthUri(
      "otpauth://totp/GitHub:alice%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub&algorithm=SHA1&digits=6&period=30",
    );
    expect(parsed).toMatchObject({
      issuer: "GitHub",
      account: "alice@example.com",
      secret: "JBSWY3DPEHPK3PXP",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
    });
  });

  test("defaults sha1/6/30 when params are absent", () => {
    const parsed = parseOtpauthUri("otpauth://totp/Acme:me?secret=JBSWY3DPEHPK3PXP");
    expect(parsed).toMatchObject({ algorithm: "SHA1", digits: 6, period: 30, issuer: "Acme" });
  });

  test("round trips through buildOtpauthUri", () => {
    const uri = buildOtpauthUri({
      label: "Acme:me@x.test",
      issuer: "Acme",
      account: "me@x.test",
      secret: "JBSWY3DPEHPK3PXP",
      algorithm: "SHA256",
      digits: 8,
      period: 60,
    });
    expect(parseOtpauthUri(uri)).toMatchObject({
      issuer: "Acme",
      account: "me@x.test",
      algorithm: "SHA256",
      digits: 8,
      period: 60,
    });
  });

  test("refuses non totp and broken secrets", () => {
    expect(() => parseOtpauthUri("https://example.com")).toThrow();
    expect(() => parseOtpauthUri("otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP")).toThrow();
    expect(() => parseOtpauthUri("otpauth://totp/x?secret=notbase321")).toThrow();
  });
});
