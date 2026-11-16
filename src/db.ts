import mysql from "mysql2/promise";

export function requireEnv(key: string): string {
  const value = process.env[key];
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export function optionalEnv(key: string, fallback: string): string {
  const value = process.env[key];
  return value === undefined || value === "" ? fallback : value;
}

export const config = {
  dbHost: optionalEnv("DB_HOST", "127.0.0.1"),
  dbPort: Number(optionalEnv("DB_PORT", "3306")),
  dbName: requireEnv("DB_NAME"),
  dbUser: requireEnv("DB_USER"),
  dbPass: requireEnv("DB_PASS"),
  port: Number(optionalEnv("APP_PORT", "8790")),
  appUrl: optionalEnv("APP_URL", "http://factorauth.test"),
  sessionTtlHours: Number(optionalEnv("SESSION_TTL_HOURS", "168")),
  cookieSecure: optionalEnv("COOKIE_SECURE", "0") === "1",
  inviteCode: optionalEnv("INVITE_CODE", ""),
  encryptionKey: requireEnv("ENCRYPTION_KEY"),
};

export const pool = mysql.createPool({
  host: config.dbHost,
  port: config.dbPort,
  database: config.dbName,
  user: config.dbUser,
  password: config.dbPass,
  waitForConnections: true,
  connectionLimit: 10,
  maxIdle: 4,
  idleTimeout: 60_000,
  enableKeepAlive: true,
  charset: "utf8mb4",
  // Store and read every DATETIME as UTC so a server on a different timezone
  // cannot shift session expiry or TOTP bookkeeping by hours.
  timezone: "Z",
  dateStrings: false,
  supportBigNumbers: true,
});

export async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const [rows] = await pool.execute(sql, params as any[]);
  return rows as T[];
}

/** INSERT/UPDATE/DELETE: returns the ResultSetHeader (insertId, affectedRows). */
export async function execute(sql: string, params: unknown[] = []) {
  const [result] = await pool.execute(sql, params as any[]);
  return result as mysql.ResultSetHeader;
}

/**
 * Runs fn inside a transaction; rolls back on any thrown error.
 */
export async function withTransaction<T>(fn: (connection: mysql.PoolConnection) => Promise<T>): Promise<T> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await fn(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function queryOne<T>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows.length > 0 ? (rows[0] as T) : null;
}
