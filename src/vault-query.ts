/**
 * Pure helpers for the vault listing query. Pulled out of the route so the
 * escaping and window maths can be tested without booting the server.
 */

/** Escapes LIKE wildcards; used with `ESCAPE '!'` in the SQL. */
export function escapeLike(value: string): string {
  return value.replace(/[!%_]/g, (character) => `!${character}`);
}

export interface VaultFilter {
  sql: string;
  params: Array<string | number>;
}

/**
 * WHERE clause for one user's vault. Search runs in MySQL over label, issuer,
 * account and notes; no filtering is done in the browser.
 */
export function buildVaultFilter(userId: number, q: string): VaultFilter {
  const clauses = ["user_id = ?"];
  const params: Array<string | number> = [userId];
  const term = q.trim();
  if (term !== "") {
    const pattern = `%${escapeLike(term)}%`;
    clauses.push(
      "(label LIKE ? ESCAPE '!' OR issuer LIKE ? ESCAPE '!' OR account LIKE ? ESCAPE '!' OR notes LIKE ? ESCAPE '!')",
    );
    params.push(pattern, pattern, pattern, pattern);
  }
  return { sql: clauses.join(" AND "), params };
}

export interface PageWindow {
  page: number;
  offset: number;
  totalPages: number;
  from: number;
  to: number;
}

/** Clamps a requested page to the rows that actually exist. */
export function pageWindow(total: number, requested: number, perPage: number): PageWindow {
  const size = Math.max(1, perPage);
  const totalPages = Math.max(1, Math.ceil(total / size));
  const wanted = Number.isFinite(requested) ? Math.floor(requested) : 1;
  const page = Math.min(Math.max(1, wanted), totalPages);
  const offset = (page - 1) * size;
  return {
    page,
    offset,
    totalPages,
    from: total === 0 ? 0 : offset + 1,
    to: Math.min(offset + size, total),
  };
}
