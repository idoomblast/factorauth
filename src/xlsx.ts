import { strFromU8, unzipSync } from "fflate";

export type CellValue = string | number | null;
export type Sheet = { name: string; rows: CellValue[][] };

/** Guards against zip bombs: only the four XML parts we need, with a size cap. */
const MAX_PART_BYTES = 20 * 1024 * 1024;
const NEEDED = [
  "xl/workbook.xml",
  "xl/_rels/workbook.xml.rels",
  "xl/sharedStrings.xml",
];

export class XlsxError extends Error {}

function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function textOf(fragment: string): string {
  const parts = [...fragment.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((match) => match[1] ?? "");
  return decodeEntities(parts.join(""));
}

function columnIndex(ref: string): number {
  const letters = /^([A-Z]+)/.exec(ref)?.[1] ?? "A";
  let index = 0;
  for (const letter of letters) {
    index = index * 26 + (letter.charCodeAt(0) - 64);
  }
  return index - 1;
}

function parseSharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) => textOf(match[1] ?? ""));
}

function parseSheet(xml: string, shared: string[], maxRows: number): CellValue[][] {
  const rows: CellValue[][] = [];
  for (const rowMatch of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    if (rows.length >= maxRows) {
      throw new XlsxError(`File punya lebih dari ${maxRows} baris. Pecah dulu filenya.`);
    }
    const row: CellValue[] = [];
    for (const cellMatch of rowMatch[1]!.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1] ?? "";
      const body = cellMatch[2] ?? "";
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      if (!ref) {
        continue;
      }
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? "n";
      let value: CellValue = null;
      if (type === "inlineStr") {
        value = textOf(/<is>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? body);
      } else {
        const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        if (raw === undefined) {
          value = null;
        } else if (type === "s") {
          value = shared[Number(raw)] ?? null;
        } else if (type === "str" || type === "d") {
          value = decodeEntities(raw);
        } else if (type === "b") {
          value = raw === "1" ? "TRUE" : "FALSE";
        } else {
          const numeric = Number(raw);
          value = Number.isFinite(numeric) ? numeric : decodeEntities(raw);
        }
      }
      row[columnIndex(ref)] = value;
    }
    rows.push(row);
  }
  return rows;
}

/**
 * Reads the first worksheet of an .xlsx file.
 * Intentionally narrow: we parse the four parts needed for cell values and
 * ignore styling, formulas and pivot tables.
 */
export function readFirstSheet(buffer: Uint8Array, maxRows = 2000): Sheet {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(buffer, {
      filter: (file) =>
        (NEEDED.includes(file.name) || file.name.startsWith("xl/worksheets/")) &&
        file.originalSize <= MAX_PART_BYTES,
    });
  } catch {
    throw new XlsxError("File tidak bisa dibuka sebagai .xlsx. Pastikan formatnya benar.");
  }

  const workbook = files["xl/workbook.xml"];
  if (!workbook) {
    throw new XlsxError("Bukan file Excel yang valid (workbook.xml tidak ada).");
  }
  const workbookXml = strFromU8(workbook);
  const sheetTag = /<sheet\b[^>]*\/>/.exec(workbookXml)?.[0] ?? "";
  const sheetName = /\bname="([^"]*)"/.exec(sheetTag)?.[1] ?? "Sheet1";
  const relationId = /\br:id="([^"]*)"/.exec(sheetTag)?.[1] ?? "";

  let target = "";
  const rels = files["xl/_rels/workbook.xml.rels"];
  if (rels && relationId) {
    const relsXml = strFromU8(rels);
    for (const rel of relsXml.matchAll(/<Relationship\b[^>]*\/>/g)) {
      const tag = rel[0];
      if (/\bId="([^"]*)"/.exec(tag)?.[1] === relationId) {
        target = /\bTarget="([^"]*)"/.exec(tag)?.[1] ?? "";
        break;
      }
    }
  }
  const sheetPath = target
    ? target.startsWith("/")
      ? target.slice(1)
      : `xl/${target.replace(/^\.\//, "")}`
    : "xl/worksheets/sheet1.xml";

  const sheetFile = files[sheetPath] ?? files["xl/worksheets/sheet1.xml"];
  if (!sheetFile) {
    throw new XlsxError("Worksheet pertama tidak ditemukan di file ini.");
  }

  const shared = files["xl/sharedStrings.xml"]
    ? parseSharedStrings(strFromU8(files["xl/sharedStrings.xml"]!))
    : [];

  return { name: decodeEntities(sheetName), rows: parseSheet(strFromU8(sheetFile), shared, maxRows) };
}
