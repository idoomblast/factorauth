import { describe, expect, test } from "bun:test";
import { readFirstSheet } from "../src/xlsx.ts";
import { parseImportSheet } from "../src/xlsx-import.ts";
import {
  buildVaultWorkbook,
  buildXlsx,
  columnName,
  EXPORT_HEADERS,
  exportRows,
  type ExportEntry,
} from "../src/xlsx-export.ts";

const entry = (overrides: Partial<ExportEntry> = {}): ExportEntry => ({
  label: "GitHub",
  issuer: "GitHub",
  account: "dev@example.test",
  secret: "JBSWY3DPEHPK3PXP",
  algorithm: "SHA1",
  digits: 6,
  period: 30,
  notes: "",
  ...overrides,
});

describe("xlsx writer", () => {
  test("names columns past Z", () => {
    expect(columnName(0)).toBe("A");
    expect(columnName(25)).toBe("Z");
    expect(columnName(26)).toBe("AA");
    expect(columnName(51)).toBe("AZ");
    expect(columnName(52)).toBe("BA");
  });

  test("round-trips text, numbers, emoji and XML characters", () => {
    const rows = [
      [...EXPORT_HEADERS],
      ["GitHub & Co", "Git<Hub>", "dev@example.test", "JBSWY3DPEHPK3PXP", "SHA1", 6, 30, 'catatan "penting" & <xml>'],
      ["Emoji 🌸", "Layanan", "a@b.test", "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", "SHA256", 8, 60, ""],
    ];
    const sheet = readFirstSheet(buildXlsx("Vault", rows));

    expect(sheet.name).toBe("Vault");
    expect(sheet.rows[0]).toEqual([...EXPORT_HEADERS]);
    expect(sheet.rows[1]).toEqual([
      "GitHub & Co",
      "Git<Hub>",
      "dev@example.test",
      "JBSWY3DPEHPK3PXP",
      "SHA1",
      6,
      30,
      'catatan "penting" & <xml>',
    ]);
    expect(sheet.rows[2]?.[0]).toBe("Emoji 🌸");
    expect(sheet.rows[2]?.[5]).toBe(8);
    expect(sheet.rows[2]?.[6]).toBe(60);
  });

  test("strips characters that XML cannot carry", () => {
    const sheet = readFirstSheet(buildXlsx("Vault", [["a\u0001b\u0008c"]]));
    expect(sheet.rows[0]?.[0]).toBe("abc");
  });

  test("sanitises sheet names Excel would reject", () => {
    const sheet = readFirstSheet(buildXlsx("Vault/2026: [dev]", [["x"]]));
    expect(sheet.name).toBe("Vault 2026   dev");
  });

  test("keeps leading and trailing spaces", () => {
    const sheet = readFirstSheet(buildXlsx("Vault", [["  spasi  "]]));
    expect(sheet.rows[0]?.[0]).toBe("  spasi  ");
  });
});

describe("vault export", () => {
  test("writes headers the importer recognises", () => {
    const rows = exportRows([entry()]);
    expect(rows[0]).toEqual([...EXPORT_HEADERS]);

    const preview = parseImportSheet(rows);
    expect(preview.layout).toBe("header");
    expect(preview.valid).toBe(1);
    expect(preview.rows[0]).toMatchObject({
      label: "GitHub",
      issuer: "GitHub",
      account: "dev@example.test",
      secret: "JBSWY3DPEHPK3PXP",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
    });
  });

  test("survives a full workbook round-trip", () => {
    const entries = [
      entry(),
      entry({
        label: "Kerja",
        issuer: "Google",
        account: "kerja@example.test",
        secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
        algorithm: "SHA256",
        digits: 8,
        period: 60,
        notes: "akun kantor",
      }),
    ];

    const preview = parseImportSheet(readFirstSheet(buildVaultWorkbook(entries)).rows);
    expect(preview.layout).toBe("header");
    expect(preview.invalid).toBe(0);
    expect(preview.valid).toBe(2);
    expect(preview.rows.map((row) => row.label)).toEqual(["GitHub", "Kerja"]);
    expect(preview.rows[1]).toMatchObject({
      algorithm: "SHA256",
      digits: 8,
      period: 60,
      notes: "akun kantor",
    });
  });

  test("exports a header-only sheet when the vault is empty", () => {
    const preview = parseImportSheet(readFirstSheet(buildVaultWorkbook([])).rows);
    expect(preview.rows).toHaveLength(0);
    expect(preview.valid).toBe(0);
  });
});
