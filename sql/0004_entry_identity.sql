-- 0004_entry_identity.sql
-- Two accounts may share one TOTP seed. Uniqueness therefore has to include the
-- entry identity (label/issuer/account) and not just the secret. entry_key is a
-- SHA-256 of that identity; it is filled by `bun run backfill:fp`.

ALTER TABLE entries
  ADD COLUMN entry_key CHAR(64) NULL AFTER secret_fp,
  DROP INDEX uq_entries_user_fp,
  ADD UNIQUE KEY uq_entries_user_key (user_id, secret_fp, entry_key);
