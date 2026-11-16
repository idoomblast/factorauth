import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import mysql from "mysql2/promise";
import { config } from "./db.ts";

const SQL_DIR = join(import.meta.dir, "..", "sql");

async function main(): Promise<void> {
  const connection = await mysql.createConnection({
    host: config.dbHost,
    port: config.dbPort,
    database: config.dbName,
    user: config.dbUser,
    password: config.dbPass,
    multipleStatements: true,
    charset: "utf8mb4",
    timezone: "Z",
  });

  try {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name VARCHAR(191) NOT NULL,
        applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    const [appliedRows] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT name FROM schema_migrations",
    );
    const applied = new Set(appliedRows.map((row) => String(row.name)));

    const files = (await readdir(SQL_DIR)).filter((name) => name.endsWith(".sql")).sort();
    let count = 0;

    for (const file of files) {
      if (applied.has(file)) {
        continue;
      }
      const sql = await readFile(join(SQL_DIR, file), "utf8");
      process.stdout.write(`applying ${file} ... `);
      await connection.query(sql);
      await connection.execute("INSERT INTO schema_migrations (name) VALUES (?)", [file]);
      console.log("ok");
      count += 1;
    }

    console.log(count === 0 ? "nothing to migrate" : `${count} migration(s) applied`);
  } finally {
    await connection.end();
  }
}

await main();
// mysql2 can leave the socket half-closed on some hosts after multi-statement
// DDL; exit explicitly so `bun run migrate` never looks hung in a deploy script.
process.exit(0);
