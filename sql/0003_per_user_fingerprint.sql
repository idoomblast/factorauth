-- 0003_per_user_fingerprint.sql
-- secret_fp is now HMAC(key, "fa:fp:v2:<userId>:<secret>"), so it differs between
-- accounts holding the same seed. Old values can never match a lookup again;
-- clear them and let `bun run backfill:fp` recompute from the encrypted secrets.

UPDATE entries SET secret_fp = NULL;
