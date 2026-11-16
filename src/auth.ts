import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { config, query, queryOne } from "./db.ts";
import { newSessionToken, randomToken, safeEqual, sha256Hex } from "./crypto.ts";

export const SESSION_COOKIE = "fa_session";
export const PRE_CSRF_COOKIE = "fa_pre_csrf";

export interface SessionUser {
  sessionId: number;
  userId: number;
  email: string;
  name: string;
  csrf: string;
}

export interface UserRow {
  id: number;
  email: string;
  name: string;
  password_hash: string;
  totp_enabled: number;
  failed_logins: number;
  locked_until: Date | null;
}

const MAX_FAILED_LOGINS = 8;
const LOCK_MINUTES = 15;

export async function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, { algorithm: "argon2id", memoryCost: 19456, timeCost: 2 });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await Bun.password.verify(password, hash);
  } catch {
    return false;
  }
}

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  return queryOne<UserRow>(
    "SELECT id, email, name, password_hash, totp_enabled, failed_logins, locked_until FROM users WHERE email = ?",
    [email.trim().toLowerCase()],
  );
}

export function isLocked(user: UserRow): boolean {
  return user.locked_until !== null && user.locked_until.getTime() > Date.now();
}

export async function registerFailedLogin(userId: number): Promise<void> {
  await query(
    `UPDATE users
        SET failed_logins = failed_logins + 1,
            locked_until = CASE WHEN failed_logins + 1 >= ? THEN DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? MINUTE) ELSE locked_until END
      WHERE id = ?`,
    [MAX_FAILED_LOGINS, LOCK_MINUTES, userId],
  );
}

export async function clearFailedLogins(userId: number): Promise<void> {
  await query("UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?", [userId]);
}

export async function createSession(c: Context, userId: number): Promise<string> {
  const { token, tokenHash } = newSessionToken();
  const csrf = randomToken(24);
  const expiresAt = new Date(Date.now() + config.sessionTtlHours * 3600 * 1000);
  const ip = (c.req.header("x-forwarded-for") ?? "").split(",")[0]?.trim() ?? "";
  const userAgent = (c.req.header("user-agent") ?? "").slice(0, 255);

  await query(
    "INSERT INTO sessions (user_id, token_hash, csrf_token, ip, user_agent, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
    [userId, tokenHash, csrf, ip.slice(0, 45), userAgent, expiresAt],
  );

  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: config.cookieSecure,
    path: "/",
    maxAge: config.sessionTtlHours * 3600,
  });

  return csrf;
}

export async function loadSession(c: Context): Promise<SessionUser | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) {
    return null;
  }
  const row = await queryOne<{
    id: number;
    user_id: number;
    csrf_token: string;
    email: string;
    name: string;
    expires_at: Date;
  }>(
    `SELECT s.id, s.user_id, s.csrf_token, s.expires_at, u.email, u.name
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP()`,
    [sha256Hex(token)],
  );
  if (!row) {
    return null;
  }
  return {
    sessionId: row.id,
    userId: row.user_id,
    email: row.email,
    name: row.name,
    csrf: row.csrf_token,
  };
}

export async function destroySession(c: Context): Promise<void> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) {
    return;
  }
  await query("DELETE FROM sessions WHERE token_hash = ?", [sha256Hex(token)]);
}

export async function purgeExpiredSessions(): Promise<void> {
  await query("DELETE FROM sessions WHERE expires_at <= UTC_TIMESTAMP()");
}

/**
 * Double submit check for anonymous forms: the token in the cookie must equal
 * the token in the form. Logged in forms use the per-session token instead.
 */
export function issuePreCsrf(c: Context): string {
  const token = randomToken(24);
  setCookie(c, PRE_CSRF_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: config.cookieSecure,
    path: "/",
    maxAge: 3600,
  });
  return token;
}

export function checkCsrf(c: Context, submitted: string, session: SessionUser | null): boolean {
  const expected = session ? session.csrf : (getCookie(c, PRE_CSRF_COOKIE) ?? "");
  if (!expected || !submitted) {
    return false;
  }
  return safeEqual(expected, submitted);
}
