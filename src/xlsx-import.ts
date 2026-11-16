import type { CellValue } from "./xlsx.ts";
import type { TotpAlgorithm } from "./crypto.ts";

export interface ParsedRow {
  /** 1-based row number in the spreadsheet, for error messages. */
  line: number;
  label: string;
  issuer: string;
  account: string;
  secret: string;
  algorithm: TotpAlgorithm;
  digits: number;
  period: number;
  notes: string;
  error?: string;
}

export interface ImportPreview {
  layout: "header" | "legacy";
  mapping: string;
  rows: ParsedRow[];
  valid: number;
  invalid: number;
  skipped: number;
}

const ALIASES: Record<string, string[]> = {
  label: ["label", "name", "nama", "judul", "title", "nama akun", "service name", "entry"],
  issuer: ["issuer", "service", "layanan", "provider", "website", "app", "situs", "platform"],
  account: ["account", "akun", "email", "username", "user", "login", "userid", "user id", "msisdn"],
  secret: ["secret", "secret_key", "secretkey", "key", "seed", "otp", "otp secret", "kode", "token"],
  algorithm: ["algorithm", "algo", "hash", "hash algorithm"],
  digits: ["digits", "digit", "length", "panjang"],
  period: ["period", "interval", "periode", "time step"],
  notes: ["notes", "note", "catatan", "description", "deskripsi", "keterangan"],
};

function text(value: CellValue): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

/** "jbsw y3dp ehpk 3pxp" -> "JBSWY3DPEHPK3PXP": exports group the seed in blocks of four. */
export function normalizeSecret(raw: string): string {
  return raw.replace(/[\s-]/g, "").toUpperCase();
}

function isBase32(value: string): boolean {
  return /^[A-Z2-7]+=*$/.test(value);
}

function columnFor(header: string): keyof typeof ALIASES | null {
  const clean = header.toLowerCase().replace(/[*\s_]+/g, " ").trim();
  for (const [field, names] of Object.entries(ALIASES)) {
    if (names.includes(clean)) {
      return field as keyof typeof ALIASES;
    }
  }
  return null;
}

function looksLikeHeader(row: CellValue[]): boolean {
  const cells = row.map((cell) => columnFor(text(cell))).filter(Boolean);
  return cells.length >= 2 && cells.includes("secret");
}

function normalizeAlgorithm(raw: string): TotpAlgorithm {
  const value = raw.trim().toUpperCase().replace(/[-_]/g, "");
  if (value === "SHA256") return "SHA256";
  if (value === "SHA512") return "SHA512";
  return "SHA1";
}

export function checkParsedRow(row: ParsedRow): void {
  if (!row.label) {
    row.error = "label kosong";
    return;
  }
  if (!row.secret) {
    row.error = "secret kosong";
    return;
  }
  if (!isBase32(row.secret)) {
    row.error = "secret bukan base32";
    return;
  }
  if (row.secret.replace(/=+$/, "").length < 16) {
    row.error = "secret terlalu pendek";
    return;
  }
  if (row.secret.length > 512) {
    row.error = "secret terlalu panjang";
    return;
  }
  if (![6, 8].includes(row.digits)) {
    row.error = "digit harus 6 atau 8";
    return;
  }
  if (!(row.period >= 10 && row.period <= 300)) {
    row.error = "periode di luar 10-300 detik";
  }
}

/**
 * Accepts either a sheet with a header row or the legacy export shape
 * (id, label, issuer, secret) that has no header at all.
 */
export function parseImportSheet(rows: CellValue[][]): ImportPreview {
  const nonEmpty = rows
    .map((cells, index) => ({ cells, index }))
    .filter(({ cells }) => cells.some((cell) => text(cell) !== ""));

  if (nonEmpty.length === 0) {
    return { layout: "legacy", mapping: "-", rows: [], valid: 0, invalid: 0, skipped: 0 };
  }

  const skipped = rows.length - nonEmpty.length;
  const firstRow = nonEmpty[0]!.cells;
  if (looksLikeHeader(firstRow)) {
    return parseWithHeader(nonEmpty, skipped);
  }
  return parseLegacy(nonEmpty, skipped);
}

function parseWithHeader(
  rows: Array<{ cells: CellValue[]; index: number }>,
  skipped: number,
): ImportPreview {
  const header = rows[0]!.cells;
  const index: Record<string, number> = {};
  header.forEach((cell, position) => {
    const field = columnFor(text(cell));
    if (field && index[field] === undefined) {
      index[field] = position;
    }
  });

  const pick = (cells: CellValue[], field: string): string => {
    const position = index[field];
    return position === undefined ? "" : text(cells[position] ?? null);
  };

  const parsed: ParsedRow[] = rows.slice(1).map(({ cells, index: rowIndex }) => {
    const label = pick(cells, "label") || pick(cells, "issuer") || pick(cells, "account");
    const row: ParsedRow = {
      line: rowIndex + 1,
      label: label.slice(0, 100),
      issuer: pick(cells, "issuer").slice(0, 100),
      account: pick(cells, "account").slice(0, 191),
      secret: normalizeSecret(pick(cells, "secret")),
      algorithm: normalizeAlgorithm(pick(cells, "algorithm")),
      digits: Number(pick(cells, "digits") || "6"),
      period: Number(pick(cells, "period") || "30"),
      notes: pick(cells, "notes").slice(0, 2000),
    };
    checkParsedRow(row);
    return row;
  });

  return summarize(
    "header",
    Object.keys(index)
      .map((field) => `${field}=kolom ${String.fromCharCode(65 + index[field]!)}`)
      .join(", "),
    parsed,
    skipped,
  );
}

function parseLegacy(
  rows: Array<{ cells: CellValue[]; index: number }>,
  skipped: number,
): ImportPreview {
  const width = Math.max(...rows.map(({ cells }) => cells.length));
  const columns = Array.from({ length: width }, (_, position) =>
    rows.map(({ cells }) => text(cells[position] ?? null)),
  );

  // Pick the most secret-looking column: every filled cell must be base32 and at
  // least one value must be long enough to be a real seed (>= 16 chars).
  // Short words like "Facebook" are technically valid base32, so length decides.
  // Pick the secret column by counting plausible seeds (base32, >= 16 chars)
  // rather than requiring every cell to be perfect: one broken row must not make
  // the whole sheet unrecognisable.
  const candidates = columns
    .map((values, position) => {
      const normalized = values.map((value) => normalizeSecret(value)).filter((value) => value !== "");
      const plausible = normalized.filter((value) => isBase32(value) && value.length >= 16);
      const seedLengths = plausible.map((value) => value.length);
      return {
        position,
        plausible: plausible.length,
        averageLength:
          seedLengths.length > 0
            ? seedLengths.reduce((sum, length) => sum + length, 0) / seedLengths.length
            : 0,
      };
    })
    .filter((candidate) => candidate.plausible > 0)
    .sort((left, right) =>
      right.plausible === left.plausible
        ? right.averageLength - left.averageLength
        : right.plausible - left.plausible,
    );

  if (candidates.length === 0) {
    throw new Error(
      "Format tidak dikenali: tidak ada kolom secret base32, dan tidak ada header yang bisa dibaca.",
    );
  }
  const secretColumn = candidates[0]!.position;

  const textColumns = columns
    .map((values, position) => ({ values, position }))
    .filter(({ position }) => position !== secretColumn)
    .filter(({ values }) => values.some((value) => value !== "" && !/^\d+$/.test(value)));

  const idColumn = columns.findIndex(
    (values, position) => position !== secretColumn && values.every((value) => /^\d+$/.test(value)),
  );
  const ordered = textColumns.filter(({ position }) => position !== idColumn);
  const labelPosition = ordered[0]?.position ?? -1;
  const issuerPosition = ordered[1]?.position ?? -1;

  const parsed: ParsedRow[] = rows.map(({ cells, index }) => {
    const value = (position: number): string => (position >= 0 ? text(cells[position] ?? null) : "");
    const row: ParsedRow = {
      line: index + 1,
      label: (value(labelPosition) || value(issuerPosition) || "Tanpa nama").slice(0, 100),
      issuer: value(issuerPosition).slice(0, 100),
      account: value(ordered[2]?.position ?? -1).slice(0, 191),
      secret: normalizeSecret(value(secretColumn)),
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      notes: "",
    };
    checkParsedRow(row);
    return row;
  });

  const name = (position: number) => (position >= 0 ? String.fromCharCode(65 + position) : "-");
  return summarize(
    "legacy",
    `label=${name(labelPosition)}, issuer=${name(issuerPosition)}, secret=${name(secretColumn)}${idColumn >= 0 ? `, id=${name(idColumn)} (diabaikan)` : ""}`,
    parsed,
    skipped,
  );
}

function summarize(
  layout: "header" | "legacy",
  mapping: string,
  rows: ParsedRow[],
  skipped: number,
): ImportPreview {
  const valid = rows.filter((row) => !row.error).length;
  return { layout, mapping, rows, valid, invalid: rows.length - valid, skipped };
}

export type DuplicateReason = "vault" | "file";

export interface DuplicateStatus {
  /** null = baris ini akan diimpor. */
  duplicate: DuplicateReason | null;
  /** Nomor baris lain di file yang benar-benar sama (secret + identitas sama). */
  duplicateLines: number[];
}

/**
 * Marks rows that cannot be imported. Uniqueness is keyed by secret *and* entry
 * identity (label/issuer/account), so two different accounts that happen to
 * share one TOTP seed are both importable; only an exact repeat is skipped.
 *
 *  - "vault": an entry with the same key already exists in this user's vault.
 *  - "file":  the same key appears earlier in the uploaded file; one copy is kept.
 */
export function markDuplicates(
  rows: ParsedRow[],
  existingKeys: ReadonlySet<string>,
  keyOf: (row: ParsedRow) => string,
): DuplicateStatus[] {
  const statuses: DuplicateStatus[] = rows.map(() => ({ duplicate: null, duplicateLines: [] }));
  const groups = new Map<string, number[]>();

  rows.forEach((row, index) => {
    if (row.error) return;
    const key = keyOf(row);
    const group = groups.get(key);
    if (group) group.push(index);
    else groups.set(key, [index]);
  });

  for (const [key, indices] of groups) {
    if (existingKeys.has(key)) {
      for (const index of indices) {
        statuses[index] = { duplicate: "vault", duplicateLines: [] };
      }
      continue;
    }
    if (indices.length < 2) continue;

    const first = indices[0]!;
    indices.forEach((index, position) => {
      const others = indices.filter((other) => other !== index).map((other) => rows[other]!.line);
      statuses[index] =
        position === 0
          ? { duplicate: null, duplicateLines: others }
          : { duplicate: "file", duplicateLines: [rows[first]!.line] };
    });
  }

  return statuses;
}
