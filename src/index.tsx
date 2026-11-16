import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { serveStatic } from "hono/bun";
import {
  PRE_CSRF_COOKIE,
  SESSION_COOKIE,
  checkCsrf,
  clearFailedLogins,
  createSession,
  destroySession,
  findUserByEmail,
  hashPassword,
  isLocked,
  issuePreCsrf,
  loadSession,
  purgeExpiredSessions,
  registerFailedLogin,
  verifyPassword,
  type SessionUser,
} from "./auth.ts";
import { config, execute, query, queryOne, withTransaction } from "./db.ts";
import {
  decryptSecret,
  encryptSecret,
  entryDedupeKey,
  entryIdentity,
  generateTotp,
  secretFingerprint,
  type TotpAlgorithm,
} from "./crypto.ts";
import { readFirstSheet, XlsxError } from "./xlsx.ts";
import {
  checkParsedRow,
  markDuplicates,
  normalizeSecret,
  parseImportSheet,
  type ParsedRow,
} from "./xlsx-import.ts";
import { buildVaultFilter, pageWindow } from "./vault-query.ts";
import { LoginPage, RegisterPage } from "./views/auth-pages.tsx";
import { EntryFormPage, type EntryFormValues } from "./views/entry-form.tsx";
import { VaultPage, type VaultEntryView } from "./views/vault.tsx";
import {
  ImportPreviewPage,
  ImportUploadPage,
  type PreviewRow,
} from "./views/import.tsx";

type Env = { Variables: { user: SessionUser | null } };

const app = new Hono<Env>();

app.use("*", logger());
app.use(
  "*",
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      mediaSrc: ["'self'", "blob:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
    referrerPolicy: "same-origin",
    crossOriginOpenerPolicy: "same-origin",
    crossOriginResourcePolicy: "same-origin",
    xFrameOptions: "DENY",
    xContentTypeOptions: "nosniff",
  }),
);

app.use("*", async (c, next) => {
  c.set("user", await loadSession(c));
  c.header("Cache-Control", "no-store");
  await next();
});

// ------------------------------------------------------------------ helpers

function field(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

interface EntryRow {
  id: number;
  label: string;
  issuer: string;
  account: string;
  secret_enc: Buffer;
  algo: string;
  digits: number;
  period: number;
  notes: string | null;
}

const ENTRY_COLUMNS = "id, label, issuer, account, secret_enc, algo, digits, period, notes";

async function listEntries(userId: number): Promise<EntryRow[]> {
  return query<EntryRow>(
    `SELECT ${ENTRY_COLUMNS} FROM entries WHERE user_id = ? ORDER BY sort_order ASC, id ASC`,
    [userId],
  );
}

const VAULT_PAGE_SIZE = 20;

interface VaultPageResult {
  rows: EntryRow[];
  total: number;
  page: number;
  totalPages: number;
  perPage: number;
}

/**
 * Search and pagination both run in MySQL. The browser only receives the rows
 * for the current page.
 */
async function listEntriesPage(userId: number, q: string, requested: number): Promise<VaultPageResult> {
  const filter = buildVaultFilter(userId, q);
  const counted = await queryOne<{ total: number }>(
    `SELECT COUNT(*) AS total FROM entries WHERE ${filter.sql}`,
    filter.params,
  );
  const total = Number(counted?.total ?? 0);
  const window = pageWindow(total, requested, VAULT_PAGE_SIZE);
  const rows =
    total === 0
      ? []
      : await query<EntryRow>(
          `SELECT ${ENTRY_COLUMNS} FROM entries WHERE ${filter.sql} ORDER BY sort_order ASC, id ASC LIMIT ? OFFSET ?`,
          [...filter.params, VAULT_PAGE_SIZE, window.offset],
        );
  return {
    rows,
    total,
    page: window.page,
    totalPages: window.totalPages,
    perPage: VAULT_PAGE_SIZE,
  };
}

async function getEntry(userId: number, id: number): Promise<EntryRow | null> {
  return queryOne<EntryRow>(`SELECT ${ENTRY_COLUMNS} FROM entries WHERE id = ? AND user_id = ?`, [
    id,
    userId,
  ]);
}

function buildVaultView(rows: EntryRow[]): VaultEntryView[] {
  return rows.map((row) => {
    try {
      const secret = decryptSecret(config.encryptionKey, Buffer.from(row.secret_enc));
      const totp = generateTotp(secret, {
        algorithm: row.algo as TotpAlgorithm,
        digits: Number(row.digits),
        period: Number(row.period),
      });
      return {
        id: row.id,
        label: row.label,
        issuer: row.issuer,
        account: row.account,
        algo: row.algo,
        digits: Number(row.digits),
        period: Number(row.period),
        code: totp.code,
        remaining: totp.remaining,
      };
    } catch {
      // Key rotated or row corrupted: keep the row visible instead of hiding it.
      return {
        id: row.id,
        label: row.label,
        issuer: row.issuer,
        account: row.account,
        algo: row.algo,
        digits: Number(row.digits),
        period: Number(row.period),
        code: "------",
        remaining: 0,
      };
    }
  });
}

function safeRedirect(c: { redirect: (path: string, status?: 303) => Response }, path: string): Response {
  return c.redirect(path, 303);
}

// ------------------------------------------------------------------- public

app.get("/", (c) => safeRedirect(c, c.get("user") ? "/vault" : "/login"));

app.get("/login", (c) => {
  if (c.get("user")) {
    return safeRedirect(c, "/vault");
  }
  const csrf = issuePreCsrf(c);
  const notice = c.req.query("registered") ? "Akun dibuat. Silakan masuk." : undefined;
  return c.html(<LoginPage csrf={csrf} notice={notice} />);
});

app.post("/login", async (c) => {
  if (c.get("user")) {
    return safeRedirect(c, "/vault");
  }
  const body = await c.req.parseBody();
  const email = normalizeEmail(field(body, "email"));
  const password = field(body, "password");
  const csrf = field(body, "_csrf");

  if (!checkCsrf(c, csrf, null)) {
    return c.html(<LoginPage csrf={issuePreCsrf(c)} error="Sesi form kedaluwarsa. Coba lagi." />, 400);
  }

  const user = await findUserByEmail(email);
  if (!user) {
    return c.html(
      <LoginPage csrf={issuePreCsrf(c)} email={email} error="Email atau password salah." />,
      401,
    );
  }
  if (isLocked(user)) {
    return c.html(
      <LoginPage
        csrf={issuePreCsrf(c)}
        email={email}
        error="Terlalu banyak percobaan gagal. Tunggu 15 menit lalu coba lagi."
      />,
      429,
    );
  }
  if (!(await verifyPassword(user.password_hash, password))) {
    await registerFailedLogin(user.id);
    return c.html(
      <LoginPage csrf={issuePreCsrf(c)} email={email} error="Email atau password salah." />,
      401,
    );
  }

  await clearFailedLogins(user.id);
  await purgeExpiredSessions();
  await createSession(c, user.id);
  deleteCookie(c, PRE_CSRF_COOKIE, { path: "/" });
  return safeRedirect(c, "/vault");
});

app.get("/register", async (c) => {
  if (c.get("user")) {
    return safeRedirect(c, "/vault");
  }
  const csrf = issuePreCsrf(c);
  return c.html(<RegisterPage csrf={csrf} inviteRequired={await inviteRequired()} />);
});

app.post("/register", async (c) => {
  if (c.get("user")) {
    return safeRedirect(c, "/vault");
  }
  const body = await c.req.parseBody();
  const csrf = field(body, "_csrf");
  if (!checkCsrf(c, csrf, null)) {
    return c.html(
      <RegisterPage
        csrf={issuePreCsrf(c)}
        inviteRequired={await inviteRequired()}
        error="Sesi form kedaluwarsa. Coba lagi."
      />,
      400,
    );
  }

  const name = field(body, "name").slice(0, 100);
  const email = normalizeEmail(field(body, "email"));
  const password = field(body, "password");
  const confirm = field(body, "password_confirm");
  const invite = field(body, "invite");
  const needsInvite = await inviteRequired();

  const fail = (message: string, status: 400 | 403 = 400) =>
    c.html(
      <RegisterPage
        csrf={issuePreCsrf(c)}
        email={email}
        name={name}
        inviteRequired={needsInvite}
        error={message}
      />,
      status,
    );

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 191) {
    return fail("Email tidak valid.");
  }
  if (password.length < 12) {
    return fail("Password minimal 12 karakter.");
  }
  if (password !== confirm) {
    return fail("Konfirmasi password tidak sama.");
  }
  if (needsInvite && invite !== config.inviteCode) {
    return fail("Kode undangan salah.", 403);
  }
  if (await findUserByEmail(email)) {
    return fail("Email sudah terdaftar.");
  }

  const passwordHash = await hashPassword(password);
  const result = await execute("INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)", [
    email,
    name,
    passwordHash,
  ]);
  const userId = Number(result.insertId);
  if (userId > 0) {
    await createSession(c, userId);
    deleteCookie(c, PRE_CSRF_COOKIE, { path: "/" });
    return safeRedirect(c, "/vault");
  }
  return safeRedirect(c, "/login?registered=1");
});

app.post("/logout", async (c) => {
  const user = c.get("user");
  const body = await c.req.parseBody();
  if (!user || !checkCsrf(c, field(body, "_csrf"), user)) {
    return c.html(<p>Permintaan tidak valid.</p>, 400);
  }
  await destroySession(c);
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return safeRedirect(c, "/login");
});

app.get("/healthz", (c) => c.json({ ok: true }));

// -------------------------------------------------------------------- vault

app.get("/vault", async (c) => {
  const user = c.get("user");
  if (!user) {
    return safeRedirect(c, "/login");
  }
  const q = (c.req.query("q") ?? "").trim().slice(0, 100);
  const requestedPage = Number(c.req.query("page") ?? "1");
  const vault = await listEntriesPage(user.userId, q, requestedPage);
  const flashMap: Record<string, string> = {
    added: "Kunci baru tersimpan.",
    updated: "Perubahan tersimpan.",
    deleted: "Kunci dihapus.",
  };
  const flash =
    c.req.query("flash") === "imported"
      ? `${Number(c.req.query("n") ?? 0)} kunci diimpor.`
      : flashMap[c.req.query("flash") ?? ""];
  return c.html(
    <VaultPage
      user={user}
      csrf={user.csrf}
      entries={buildVaultView(vault.rows)}
      total={vault.total}
      page={vault.page}
      totalPages={vault.totalPages}
      perPage={vault.perPage}
      q={q}
      flash={flash}
    />,
  );
});

app.get("/api/codes", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const requestedIds = (c.req.query("ids") ?? "")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0)
    .slice(0, 200);
  const rows =
    requestedIds.length > 0
      ? await query<EntryRow>(
          `SELECT ${ENTRY_COLUMNS} FROM entries
            WHERE user_id = ? AND id IN (${requestedIds.map(() => "?").join(",")})
            ORDER BY sort_order ASC, id ASC`,
          [user.userId, ...requestedIds],
        )
      : await listEntries(user.userId);
  return c.json({
    now: Math.floor(Date.now() / 1000),
    items: buildVaultView(rows).map((entry) => ({
      id: entry.id,
      code: entry.code,
      remaining: entry.remaining,
      period: entry.period,
      digits: entry.digits,
    })),
  });
});

// ------------------------------------------------------------------- create

app.get("/entries/new", (c) => {
  const user = c.get("user");
  if (!user) {
    return safeRedirect(c, "/login");
  }
  return c.html(<EntryFormPage user={user} csrf={user.csrf} mode="new" />);
});

app.post("/entries", async (c) => {
  const user = c.get("user");
  if (!user) {
    return safeRedirect(c, "/login");
  }
  const body = await c.req.parseBody();
  const values: EntryFormValues = {
    label: field(body, "label").slice(0, 100),
    issuer: field(body, "issuer").slice(0, 100),
    account: field(body, "account").slice(0, 191),
    algo: field(body, "algorithm") || "SHA1",
    digits: Number(field(body, "digits") || "6"),
    period: Number(field(body, "period") || "30"),
    notes: field(body, "notes").slice(0, 2000),
  };
  const rawSecret = field(body, "secret").replace(/\s/g, "").toUpperCase();

  if (!checkCsrf(c, field(body, "_csrf"), user)) {
    return c.html(
      <EntryFormPage user={user} csrf={user.csrf} mode="new" values={values} error="Sesi form kedaluwarsa." />,
      400,
    );
  }

  const problem = validateEntry(values, rawSecret, true);
  if (problem) {
    return c.html(<EntryFormPage user={user} csrf={user.csrf} mode="new" values={values} error={problem} />, 400);
  }

  try {
    await insertEntry(user.userId, {
      label: values.label ?? "",
      issuer: values.issuer ?? "",
      account: values.account ?? "",
      secret: rawSecret,
      algorithm: (values.algo ?? "SHA1") as TotpAlgorithm,
      digits: Number(values.digits),
      period: Number(values.period),
      notes: values.notes ?? "",
    });
  } catch (error) {
    if (isDuplicateSecret(error)) {
      return c.html(
        <EntryFormPage
          user={user}
          csrf={user.csrf}
          mode="new"
          values={values}
          error="Secret ini sudah ada di vault kamu."
        />,
        409,
      );
    }
    throw error;
  }
  return safeRedirect(c, "/vault?flash=added");
});

// --------------------------------------------------------------------- edit

app.get("/entries/:id/edit", async (c) => {
  const user = c.get("user");
  if (!user) {
    return safeRedirect(c, "/login");
  }
  const row = await getEntry(user.userId, Number(c.req.param("id")));
  if (!row) {
    return c.notFound();
  }
  return c.html(
    <EntryFormPage
      user={user}
      csrf={user.csrf}
      mode="edit"
      values={{
        id: row.id,
        label: row.label,
        issuer: row.issuer,
        account: row.account,
        algo: row.algo,
        digits: Number(row.digits),
        period: Number(row.period),
        notes: row.notes ?? "",
      }}
    />,
  );
});

app.post("/entries/:id", async (c) => {
  const user = c.get("user");
  if (!user) {
    return safeRedirect(c, "/login");
  }
  const id = Number(c.req.param("id"));
  const existing = await getEntry(user.userId, id);
  if (!existing) {
    return c.notFound();
  }
  const body = await c.req.parseBody();
  const values: EntryFormValues = {
    id,
    label: field(body, "label").slice(0, 100),
    issuer: field(body, "issuer").slice(0, 100),
    account: field(body, "account").slice(0, 191),
    algo: field(body, "algorithm") || existing.algo,
    digits: Number(field(body, "digits") || String(existing.digits)),
    period: Number(field(body, "period") || String(existing.period)),
    notes: field(body, "notes").slice(0, 2000),
  };
  const rawSecret = field(body, "secret").replace(/\s/g, "").toUpperCase();

  if (!checkCsrf(c, field(body, "_csrf"), user)) {
    return c.html(
      <EntryFormPage user={user} csrf={user.csrf} mode="edit" values={values} error="Sesi form kedaluwarsa." />,
      400,
    );
  }
  const problem = validateEntry(values, rawSecret, false);
  if (problem) {
    return c.html(<EntryFormPage user={user} csrf={user.csrf} mode="edit" values={values} error={problem} />, 400);
  }

  const identity = entryIdentity(values.label ?? "", values.issuer ?? "", values.account ?? "");

  if (rawSecret) {
    try {
      await query(
        `UPDATE entries SET label = ?, issuer = ?, account = ?, secret_enc = ?, secret_fp = ?, entry_key = ?, algo = ?, digits = ?, period = ?, notes = ?
          WHERE id = ? AND user_id = ?`,
        [
          values.label,
          values.issuer,
          values.account,
          encryptSecret(config.encryptionKey, rawSecret),
          secretFingerprint(config.encryptionKey, user.userId, rawSecret),
          identity,
          values.algo,
          values.digits,
          values.period,
          values.notes || null,
          id,
          user.userId,
        ],
      );
    } catch (error) {
      if (isDuplicateSecret(error)) {
        return c.html(
          <EntryFormPage
            user={user}
            csrf={user.csrf}
            mode="edit"
            values={values}
            error="Secret ini sudah dipakai kunci lain di vault kamu."
          />,
          409,
        );
      }
      throw error;
    }
  } else {
    try {
      await query(
        `UPDATE entries SET label = ?, issuer = ?, account = ?, entry_key = ?, algo = ?, digits = ?, period = ?, notes = ?
          WHERE id = ? AND user_id = ?`,
        [
          values.label,
          values.issuer,
          values.account,
          identity,
          values.algo,
          values.digits,
          values.period,
          values.notes || null,
          id,
          user.userId,
        ],
      );
    } catch (error) {
      if (isDuplicateSecret(error)) {
        return c.html(
          <EntryFormPage
            user={user}
            csrf={user.csrf}
            mode="edit"
            values={values}
            error="Sudah ada kunci lain dengan akun dan secret yang sama."
          />,
          409,
        );
      }
      throw error;
    }
  }
  return safeRedirect(c, "/vault?flash=updated");
});

app.post("/entries/:id/delete", async (c) => {
  const user = c.get("user");
  if (!user) {
    return safeRedirect(c, "/login");
  }
  const body = await c.req.parseBody();
  if (!checkCsrf(c, field(body, "_csrf"), user)) {
    return c.html(<p>Sesi form kedaluwarsa.</p>, 400);
  }
  await query("DELETE FROM entries WHERE id = ? AND user_id = ?", [
    Number(c.req.param("id")),
    user.userId,
  ]);
  return safeRedirect(c, "/vault?flash=deleted");
});

// -------------------------------------------------------------- validation

function validateEntry(values: EntryFormValues, secret: string, requireSecret: boolean): string | null {
  if (!values.label) {
    return "Label wajib diisi.";
  }
  if (requireSecret && !secret) {
    return "Secret wajib diisi.";
  }
  if (secret) {
    if (!/^[A-Z2-7]+=*$/.test(secret)) {
      return "Secret harus base32 (A-Z dan 2-7).";
    }
    if (secret.replace(/=+$/, "").length < 16) {
      return "Secret terlalu pendek. Umumnya 16 karakter base32 atau lebih.";
    }
  }
  if (!["SHA1", "SHA256", "SHA512"].includes(String(values.algo))) {
    return "Algoritma tidak dikenal.";
  }
  if (![6, 8].includes(Number(values.digits))) {
    return "Digit harus 6 atau 8.";
  }
  if (!(Number(values.period) >= 10 && Number(values.period) <= 300)) {
    return "Periode harus antara 10 dan 300 detik.";
  }
  return null;
}

async function inviteRequired(): Promise<boolean> {
  const row = await queryOne<{ total: number }>("SELECT COUNT(*) AS total FROM users");
  if (!row || Number(row.total) === 0) {
    return false;
  }
  return config.inviteCode !== "";
}

// --------------------------------------------------------------- import xlsx

interface NewEntry {
  label: string;
  issuer: string;
  account: string;
  secret: string;
  algorithm: TotpAlgorithm;
  digits: number;
  period: number;
  notes: string;
}

async function insertEntry(userId: number, row: NewEntry): Promise<number> {
  const result = await execute(
    `INSERT INTO entries (user_id, label, issuer, account, secret_enc, secret_fp, entry_key, algo, digits, period, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      row.label,
      row.issuer,
      row.account,
      encryptSecret(config.encryptionKey, row.secret),
      secretFingerprint(config.encryptionKey, userId, row.secret),
      entryIdentity(row.label, row.issuer, row.account),
      row.algorithm,
      row.digits,
      row.period,
      row.notes || null,
    ],
  );
  return Number(result.insertId);
}

function isDuplicateSecret(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "ER_DUP_ENTRY"
  );
}

async function existingEntryKeys(userId: number): Promise<Set<string>> {
  const rows = await query<{ secret_fp: string; entry_key: string | null }>(
    `SELECT secret_fp, entry_key FROM entries
      WHERE user_id = ? AND secret_fp IS NOT NULL AND entry_key IS NOT NULL`,
    [userId],
  );
  return new Set(rows.map((row) => entryDedupeKey(row.secret_fp, row.entry_key!)));
}

/** Key used to decide whether a parsed row is already known. */
function dedupeKeyFor(userId: number, row: ParsedRow): string {
  return entryDedupeKey(
    secretFingerprint(config.encryptionKey, userId, row.secret),
    entryIdentity(row.label, row.issuer, row.account),
  );
}

/** Rebuilt from the hidden payload; never trusted as-is. */
function rowFromPayload(raw: unknown): ParsedRow | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  const asText = (key: string, limit: number): string =>
    typeof value[key] === "string" ? (value[key] as string).slice(0, limit) : "";
  const row: ParsedRow = {
    line: Number(value.line) || 0,
    label: asText("label", 100),
    issuer: asText("issuer", 100),
    account: asText("account", 191),
    secret: normalizeSecret(asText("secret", 512)),
    algorithm: (["SHA1", "SHA256", "SHA512"] as const).includes(
      asText("algorithm", 8).toUpperCase() as TotpAlgorithm,
    )
      ? (asText("algorithm", 8).toUpperCase() as TotpAlgorithm)
      : "SHA1",
    digits: Number(value.digits) === 8 ? 8 : 6,
    period: Number(value.period) || 30,
    notes: asText("notes", 2000),
  };
  checkParsedRow(row);
  return row;
}

app.get("/import", (c) => {
  const user = c.get("user");
  if (!user) {
    return safeRedirect(c, "/login");
  }
  return c.html(<ImportUploadPage user={user} csrf={user.csrf} />);
});

app.post("/import/preview", async (c) => {
  const user = c.get("user");
  if (!user) {
    return safeRedirect(c, "/login");
  }
  const body = await c.req.parseBody();
  if (!checkCsrf(c, field(body, "_csrf"), user)) {
    return c.html(<ImportUploadPage user={user} csrf={user.csrf} error="Sesi form kedaluwarsa." />, 400);
  }

  const upload = body["file"];
  if (!(upload instanceof File) || upload.size === 0) {
    return c.html(
      <ImportUploadPage user={user} csrf={user.csrf} error="Pilih file .xlsx dulu." />,
      400,
    );
  }
  if (upload.size > 4 * 1024 * 1024) {
    return c.html(
      <ImportUploadPage user={user} csrf={user.csrf} error="File lebih dari 4 MB." />,
      400,
    );
  }

  let preview;
  let sheetName = "";
  try {
    const sheet = readFirstSheet(new Uint8Array(await upload.arrayBuffer()));
    sheetName = sheet.name;
    preview = parseImportSheet(sheet.rows);
  } catch (error) {
    const message = error instanceof XlsxError || error instanceof Error ? error.message : "File tidak bisa dibaca.";
    return c.html(<ImportUploadPage user={user} csrf={user.csrf} error={message} />, 400);
  }

  if (preview.rows.length === 0) {
    return c.html(
      <ImportUploadPage
        user={user}
        csrf={user.csrf}
        error="Tidak ada baris berisi secret di sheet pertama."
      />,
      400,
    );
  }

  const known = await existingEntryKeys(user.userId);
  const statuses = markDuplicates(preview.rows, known, (row) => dedupeKeyFor(user.userId, row));
  const rows: PreviewRow[] = preview.rows.map((row, index) => ({ ...row, ...statuses[index]! }));

  const payload = JSON.stringify(
    rows.map((row) => ({
      line: row.line,
      label: row.label,
      issuer: row.issuer,
      account: row.account,
      secret: row.secret,
      algorithm: row.algorithm,
      digits: row.digits,
      period: row.period,
      notes: row.notes,
      error: row.error ?? null,
    })),
  );

  return c.html(
    <ImportPreviewPage
      user={user}
      csrf={user.csrf}
      sheetName={sheetName}
      mapping={preview.mapping}
      layout={preview.layout}
      rows={rows}
      skipped={preview.skipped}
      payload={payload}
    />,
  );
});

app.post("/import/confirm", async (c) => {
  const user = c.get("user");
  if (!user) {
    return safeRedirect(c, "/login");
  }
  const body = await c.req.parseBody();
  if (!checkCsrf(c, field(body, "_csrf"), user)) {
    return c.html(<p>Sesi form kedaluwarsa.</p>, 400);
  }

  let incoming: unknown[] = [];
  try {
    const parsed = JSON.parse(String(body["payload"] ?? "[]"));
    incoming = Array.isArray(parsed) ? parsed.slice(0, 2000) : [];
  } catch {
    return c.html(<p>Data impor tidak valid. Ulangi dari halaman impor.</p>, 400);
  }

  const known = await existingEntryKeys(user.userId);
  const rows = incoming
    .map(rowFromPayload)
    .filter((row): row is ParsedRow => row !== null);
  const statuses = markDuplicates(rows, known, (row) => dedupeKeyFor(user.userId, row));
  // Recompute the verdict here instead of trusting the hidden payload: the vault
  // may have changed since the preview, and conflicting rows must stay out.
  const accepted = rows.filter((row, index) => !row.error && !statuses[index]!.duplicate);

  if (accepted.length === 0) {
    return safeRedirect(c, "/vault?flash=imported&n=0");
  }

  const inserted = await withTransaction(async (connection) => {
    let count = 0;
    for (const row of accepted) {
      try {
        await connection.execute(
          `INSERT INTO entries (user_id, label, issuer, account, secret_enc, secret_fp, entry_key, algo, digits, period, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            user.userId,
            row.label,
            row.issuer,
            row.account,
            encryptSecret(config.encryptionKey, row.secret),
            secretFingerprint(config.encryptionKey, user.userId, row.secret),
            entryIdentity(row.label, row.issuer, row.account),
            row.algorithm,
            row.digits,
            row.period,
            row.notes || null,
          ],
        );
        count += 1;
      } catch (error) {
        // Two tabs confirming at once can slip past the earlier duplicate scan.
        // The unique index is the real guard, so a collision just skips the row.
        if (!isDuplicateSecret(error)) throw error;
      }
    }
    return count;
  });

  return safeRedirect(c, `/vault?flash=imported&n=${inserted}`);
});

// --------------------------------------------------------------- static last

app.use("/*", serveStatic({ root: "./public" }));

app.notFound((c) => c.html(<p>Halaman tidak ditemukan.</p>, 404));

app.onError((error, c) => {
  console.error(`[error] ${c.req.method} ${c.req.path}:`, error);
  return c.html(<p>Ada masalah di server. Coba lagi.</p>, 500);
});

export default {
  port: config.port,
  fetch: app.fetch,
};
