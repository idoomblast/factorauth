import { strToU8, zipSync } from "fflate";
import type { CellValue } from "./xlsx.ts";

/**
 * Writes the same header layout that `src/xlsx-import.ts` recognises, so an
 * exported file can be imported again without any manual column mapping.
 */
export const EXPORT_HEADERS = [
  "label",
  "issuer",
  "account",
  "secret",
  "algorithm",
  "digits",
  "period",
  "notes",
] as const;

export interface ExportEntry {
  label: string;
  issuer: string;
  account: string;
  secret: string;
  algorithm: string;
  digits: number;
  period: number;
  notes: string;
}

const MAX_CELL_CHARS = 32767;
const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

function escapeXml(value: string): string {
  return value
    .replace(INVALID_XML_CHARS, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** 0 -> A, 25 -> Z, 26 -> AA. */
export function columnName(index: number): string {
  let name = "";
  let value = index + 1;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function cellXml(ref: string, value: CellValue): string {
  if (value === null || value === "") {
    return "";
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${ref}"><v>${value}</v></c>`;
  }
  const text = String(value).slice(0, MAX_CELL_CHARS);
  // Keep leading/trailing spaces: import trims them, but other readers should
  // still see exactly what was stored.
  const preserve = /^\s|\s$/.test(text) ? ' xml:space="preserve"' : "";
  return `<c r="${ref}" t="inlineStr"><is><t${preserve}>${escapeXml(text)}</t></is></c>`;
}

function sheetName(input: string): string {
  const clean = input.replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 31);
  return clean || "Vault";
}

/** Rows in the same order as EXPORT_HEADERS, ready for `buildXlsx`. */
export function exportRows(entries: ExportEntry[]): CellValue[][] {
  return [
    [...EXPORT_HEADERS],
    ...entries.map((entry) => [
      entry.label,
      entry.issuer,
      entry.account,
      entry.secret,
      entry.algorithm,
      entry.digits,
      entry.period,
      entry.notes,
    ]),
  ];
}

/**
 * Minimal .xlsx writer: inline strings, one worksheet, no shared strings and no
 * styling. Deliberately small; the reader in `src/xlsx.ts` only needs cells.
 */
export function buildXlsx(name: string, rows: CellValue[][]): Uint8Array<ArrayBuffer> {
  const lastRow = Math.max(rows.length, 1);
  const lastColumn = columnName(Math.max(...rows.map((row) => row.length), 1) - 1);
  const sheetRows = rows
    .map((cells, rowIndex) => {
      const cellsXml = cells
        .map((value, columnIndex) => cellXml(`${columnName(columnIndex)}${rowIndex + 1}`, value))
        .join("");
      return `<row r="${rowIndex + 1}">${cellsXml}</row>`;
    })
    .join("");

  const worksheet =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<dimension ref="A1:${lastColumn}${lastRow}"/>` +
    `<sheetData>${sheetRows}</sheetData>` +
    `</worksheet>`;

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
    `</Types>`;

  const rootRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`;

  const workbook =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets><sheet name="${escapeXml(sheetName(name))}" sheetId="1" r:id="rId1"/></sheets>` +
    `</workbook>`;

  const workbookRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
    `</Relationships>`;

  const zipped = zipSync(
    {
      "[Content_Types].xml": strToU8(contentTypes),
      "_rels/.rels": strToU8(rootRels),
      "xl/workbook.xml": strToU8(workbook),
      "xl/_rels/workbook.xml.rels": strToU8(workbookRels),
      "xl/worksheets/sheet1.xml": strToU8(worksheet),
    },
    { level: 6 },
  );
  // Copy into an ArrayBuffer-backed view so it satisfies BodyInit's stricter type.
  return new Uint8Array(zipped);
}

export function buildVaultWorkbook(entries: ExportEntry[]): Uint8Array<ArrayBuffer> {
  return buildXlsx("Vault", exportRows(entries));
}
