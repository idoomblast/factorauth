import { config, query } from "./db.ts";
import { decryptSecret, entryIdentity, secretFingerprint } from "./crypto.ts";

interface Row {
  id: number;
  user_id: number;
  label: string;
  issuer: string;
  account: string;
  secret_enc: Buffer;
}

/**
 * Recomputes secret_fp and entry_key for every row.
 * Safe to run repeatedly: the same input produces the same values. A row whose
 * values collide with a kept row is left with NULLs instead of aborting.
 */
async function main(): Promise<void> {
  const rows = await query<Row>(
    "SELECT id, user_id, label, issuer, account, secret_enc FROM entries",
  );
  const seen = new Set<string>();
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    let secret: string;
    try {
      secret = decryptSecret(config.encryptionKey, Buffer.from(row.secret_enc));
    } catch {
      skipped += 1;
      console.warn(`baris ${row.id}: secret tidak bisa didekripsi, dibiarkan (NULL)`);
      continue;
    }

    const fingerprint = secretFingerprint(config.encryptionKey, row.user_id, secret);
    const identity = entryIdentity(row.label, row.issuer, row.account);
    const dedupeKey = `${row.user_id}:${fingerprint}:${identity}`;
    if (seen.has(dedupeKey)) {
      skipped += 1;
      console.warn(`baris ${row.id}: duplikat persis di akun yang sama, dibiarkan (NULL)`);
      continue;
    }
    seen.add(dedupeKey);

    await query("UPDATE entries SET secret_fp = ?, entry_key = ? WHERE id = ?", [
      fingerprint,
      identity,
      row.id,
    ]);
    updated += 1;
  }

  console.log(`${updated} baris diperbarui, ${skipped} dilewati`);
}

await main();
process.exit(0);
