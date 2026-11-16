import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { readFirstSheet, XlsxError } from "../src/xlsx.ts";
import { markDuplicates, normalizeSecret, parseImportSheet, type ParsedRow } from "../src/xlsx-import.ts";
import { entryIdentity } from "../src/crypto.ts";

async function readFixture(name: string): Promise<Uint8Array> {
  return new Uint8Array(await Bun.file(join(import.meta.dir, "fixtures", name)).arrayBuffer());
}

describe("xlsx reader", () => {
  test("reads shared strings, numbers and the sheet name", async () => {
    const sheet = readFirstSheet(await readFixture("legacy.xlsx"));
    expect(sheet.name).toBe("Sheet1");
    expect(sheet.rows[0]).toEqual([1, "Akun Lama", "Facebook", "JBSW Y3DP EHPK 3PXP"]);
    expect(sheet.rows[1]?.[3]).toBe("GEZD GNBV GY3T QOJQ GEZD GNBV GY3T QOJQ");
  });

  test("reads inline strings and numeric cells", async () => {
    const sheet = readFirstSheet(await readFixture("header.xlsx"));
    expect(sheet.name).toBe("Import");
    expect(sheet.rows[0]?.[0]).toBe("Label");
    expect(sheet.rows[1]?.[5]).toBe(8);
    expect(sheet.rows[1]?.[6]).toBe(60);
  });

  test("rejects files that are not xlsx", async () => {
    expect(() => readFirstSheet(new Uint8Array([1, 2, 3, 4]))).toThrow(XlsxError);
  });

  test("refuses sheets over the row cap", async () => {
    const sheet = await readFixture("legacy.xlsx");
    expect(() => readFirstSheet(sheet, 2)).toThrow(/lebih dari 2 baris/);
  });
});

describe("import mapping", () => {
  test("normalises grouped secrets", () => {
    expect(normalizeSecret(" jbs w y3dp ehpk-3pxp ")).toBe("JBSWY3DPEHPK3PXP");
  });

  test("handles the legacy export shape with no header", async () => {
    const preview = parseImportSheet(readFirstSheet(await readFixture("legacy.xlsx")).rows);
    expect(preview.layout).toBe("legacy");
    expect(preview.rows).toHaveLength(3);
    // The fixture ships one deliberately blank row; it must not be counted as data.
    expect(preview.skipped).toBe(1);
    expect(preview.valid).toBe(2);
    expect(preview.invalid).toBe(1);

    const [first, second, broken] = preview.rows;
    expect(first?.label).toBe("Akun Lama");
    expect(first?.issuer).toBe("Facebook");
    expect(first?.secret).toBe("JBSWY3DPEHPK3PXP");
    expect(first?.error).toBeUndefined();

    expect(second?.secret).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");

    // "bukan-secret" is all A-Z, so it is valid base32 but far too short.
    expect(broken?.error).toBe("secret terlalu pendek");
    expect(preview.mapping).toContain("secret=D");
    expect(preview.mapping).toContain("id=A (diabaikan)");
  });

  test("handles a header row with algorithm, digits and period", async () => {
    const preview = parseImportSheet(readFirstSheet(await readFixture("header.xlsx")).rows);
    expect(preview.layout).toBe("header");
    expect(preview.valid).toBe(2);
    expect(preview.skipped).toBe(0);

    const [first, second] = preview.rows;
    expect(first).toMatchObject({
      label: "Akun Kerja",
      issuer: "Google",
      account: "a@b.test",
      secret: "JBSWY3DPEHPK3PXP",
      algorithm: "SHA256",
      digits: 8,
      period: 60,
      notes: "catatan",
    });
    // Empty Algorithm/Digits/Period cells fall back to the TOTP defaults.
    expect(second).toMatchObject({ algorithm: "SHA1", digits: 6, period: 30 });
  });

  test("flags characters outside the base32 alphabet", () => {
    const preview = parseImportSheet([
      [1, "X", "Y", "JBSWY3DPEHPK3PXP"],
      [2, "Z", "W", "AB1CD2EF"],
    ]);
    expect(preview.rows[0]?.error).toBeUndefined();
    expect(preview.rows[1]?.error).toBe("secret bukan base32");
  });

  test("flags rows without a secret and rows with a short one", () => {
    const preview = parseImportSheet([
      [1, "A", "Issuer", "JBSWY3DPEHPK3PXP"],
      [2, "B", "Issuer", ""],
      [3, "C", "Issuer", "JBSWY3DP"],
    ]);
    expect(preview.valid).toBe(1);
    expect(preview.rows[1]?.error).toBe("secret kosong");
    expect(preview.rows[2]?.error).toBe("secret terlalu pendek");
  });

  test("explains itself when the shape is unknown", () => {
    expect(() => parseImportSheet([["halo", "dunia"], ["foo", "bar"]])).toThrow(/Format tidak dikenali/);
  });

  test("returns an empty preview for an empty sheet", () => {
    const preview = parseImportSheet([[null, ""], [null, null]]);
    expect(preview.rows).toHaveLength(0);
    expect(preview.valid).toBe(0);
  });
});


describe("duplicate marking", () => {
  const row = (line: number, label: string, secret: string): ParsedRow => ({
    line,
    label,
    issuer: "Vultr",
    account: "",
    secret,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    notes: "",
  });
  // Mirrors the production key: same secret + same identity is a duplicate,
  // same secret under a different label is a different account.
  const keyOf = (item: ParsedRow): string => `${item.secret}|${item.label}|${item.issuer}|${item.account}`;
  const empty = new Set<string>();

  test("allows two accounts to share one secret", () => {
    const rows = [row(13, "dev@example.com", "SEED"), row(15, "prod@example.com", "SEED")];
    const statuses = markDuplicates(rows, empty, keyOf);
    expect(statuses.map((status) => status.duplicate)).toEqual([null, null]);
  });

  test("skips an exact repeat and keeps the first copy", () => {
    const rows = [row(1, "A", "SEED"), row(2, "A", "SEED")];
    const statuses = markDuplicates(rows, empty, keyOf);
    expect(statuses[0]?.duplicate).toBeNull();
    expect(statuses[1]).toEqual({ duplicate: "file", duplicateLines: [1] });
  });

  test("only the exact key counts as already in the vault", () => {
    const rows = [row(1, "A", "SEED"), row(2, "B", "SEED")];
    const statuses = markDuplicates(rows, new Set([keyOf(row(1, "A", "SEED"))]), keyOf);
    expect(statuses.map((status) => status.duplicate)).toEqual(["vault", null]);
  });

  test("ignores rows that failed parsing", () => {
    const broken = { ...row(3, "A", "SEED"), error: "secret terlalu pendek" };
    const statuses = markDuplicates([broken, row(4, "A", "SEED")], empty, keyOf);
    expect(statuses[0]?.duplicate).toBeNull();
    expect(statuses[1]?.duplicate).toBeNull();
  });
});

describe("entry identity", () => {
  test("ignores case and surrounding spaces", () => {
    expect(entryIdentity(" Vultr ", "Vultr", "a@b.c")).toBe(entryIdentity("vultr", "vultr", "A@B.C"));
  });

  test("separates different accounts", () => {
    expect(entryIdentity("dev@example.com", "Vultr", "")).not.toBe(
      entryIdentity("prod@example.com", "Vultr", ""),
    );
  });
});
