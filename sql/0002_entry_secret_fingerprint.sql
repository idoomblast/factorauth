-- 0002_entry_secret_fingerprint.sql
-- HMAC-SHA256 of the normalized secret (keyed with ENCRYPTION_KEY) so the
-- importer can detect duplicates without decrypting or comparing plaintext.
-- NULL allowed: rows created before this migration simply have no fingerprint.

ALTER TABLE entries
  ADD COLUMN secret_fp CHAR(64) NULL AFTER secret_enc,
  ADD UNIQUE KEY uq_entries_user_fp (user_id, secret_fp);
