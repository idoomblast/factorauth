# factorauth

Vault TOTP multi-user. Secret 2FA disimpan terenkripsi di MySQL, kode dibuat di server, dan secret tidak pernah dikirim ke browser.

Stack: Bun + Hono + mysql2 + server-rendered JSX + CSS tulis tangan (tanpa Tailwind, tanpa build step frontend).

## Kenapa bukan penyimpanan plaintext

Implementasi lain yang sempat saya audit menyimpan `secret_key` apa adanya. Siapa pun yang bisa `SELECT` atau mengambil dump database langsung memegang semua kunci 2FA pemiliknya. Di sini:

- Secret dienkripsi AES-256-GCM per baris: `[version:1][nonce:12][tag:16][ciphertext]`, disimpan di `VARBINARY` supaya konversi charset tidak bisa merusak byte.
- Kode TOTP dihitung di server. Endpoint hanya mengembalikan `{code, remaining, period}`, bukan secret.
- QR didekode di browser (jsQR), jadi gambar QR tidak pernah diunggah dan tidak ada file sementara berisi secret di disk.

## Struktur

```
src/
  index.tsx      route + validasi + render
  crypto.ts      AES-256-GCM, base32, TOTP (RFC 6238), otpauth, token sesi
  xlsx.ts        pembaca .xlsx minimal (fflate + XML, tanpa SheetJS)
  xlsx-import.ts pemetaan kolom + validasi baris impor
  auth.ts        argon2id, sesi, CSRF, lockout
  db.ts          pool mysql2, config env
  migrate.ts     runner SQL idempoten
  views/         layout, login/register, vault, form entri, impor
sql/             migrasi .sql
public/          style.css, app.js (kode live), entry-form.js (QR), jsQR.js
test/            unit test crypto (termasuk vektor RFC 6238)
```

## Development

```bash
cp .env.example .env        # lalu isi ENCRYPTION_KEY (base64 32 byte)
bun install
bun run migrate
bun run dev                 # http://localhost:8790
bun test
```

Skema sengaja dibuat portable: jalan di MySQL 5.7 maupun 8.0, collation eksplisit `utf8mb4_unicode_ci`, tanpa functional index atau CHECK constraint. Kredensial koneksi diatur lewat `.env`, tidak ada nilai bawaan yang menunjuk server tertentu.

## Vault

Daftar kunci, pencarian, dan paginasi diproses di server (MySQL), bukan di browser:

- `GET /vault?q=<istilah>&page=<n>` menjalankan `WHERE user_id = ? AND (label LIKE ? OR issuer LIKE ? OR account LIKE ? OR notes LIKE ?)` dengan wildcard di-escape (`ESCAPE '!'`), lalu `COUNT(*)` dan `LIMIT/OFFSET` (20 baris per halaman). Nomor halaman di luar batas dijepit ke halaman terakhir.
- Browser hanya menerima baris halaman aktif. `/api/codes?ids=...` menghitung TOTP hanya untuk baris yang sedang tampil, dan id yang bukan milik user diabaikan.
- Klik kode menyalin digit ke clipboard (fallback `execCommand` untuk http/browser lama). Tooltip "Klik untuk salin kode" muncul saat hover/focus, berubah jadi "Tersalin!" selama 1,2 detik, dan statusnya diumumkan lewat `role="status"`.

## Impor dari Excel

`/import` menerima file `.xlsx` dan membaca **sheet pertama**. File bisa ditarik ke dropzone atau dipilih lewat dialog; nama dan ukuran file langsung tampil sebelum diproses. Dua bentuk didukung:

| Bentuk | Kolom |
|---|---|
| Tanpa header (export lama) | `id`, `label`, `issuer`, `secret` — kolom id diabaikan |
| Dengan header | dikenali dari nama kolom: `Label`, `Issuer`, `Account`, `Secret`, `Algorithm`, `Digits`, `Period`, `Notes` |

Detail:

- Secret boleh berkelompok (`JBSW Y3DP EHPK 3PXP`) atau menyambung; dibersihkan sebelum enkripsi.
- Kolom secret dideteksi dengan mencari kolom base32 yang punya nilai panjang (>= 16 karakter), jadi satu baris rusak tidak menggagalkan seluruh file.
- Ada tahap pratinjau: jumlah siap/duplikat/bermasalah, plus alasan per baris.
- Duplikat dideteksi lewat `secret_fp` = HMAC-SHA256("fa:fp:v2:" + user_id + ":" + secret) dengan kunci enkripsi, plus `entry_key` = SHA-256(label, issuer, account). Keunikan dijaga indeks `uq_entries_user_key (user_id, secret_fp, entry_key)`. Artinya dua akun berbeda boleh memakai seed yang sama (mis. dua akun Vultr dengan login berbeda), dan yang dianggap duplikat hanya entri dengan secret **dan** identitas yang sama. Fingerprint di-scope per user, jadi isi tabel tidak bisa dipakai mengorelasikan user. Impor file yang sama dua kali aman: unggahan kedua masuk hitungan "sudah di vault". Setelah upgrade dari skema lama jalankan `bun run backfill:fp` untuk menghitung ulang fingerprint dan entry_key.
- Saat pratinjau, tiap baris diberi status yang jelas: **siap**, **sudah di vault** (secret + label/issuer/akun sudah ada di akun ini), atau **kembar baris N** (baris persis sama di file yang sama, satu salinan tetap diimpor). Dua akun berbeda dengan seed sama tetap **siap**, karena kode 2FA-nya memang sama.
- Batas: 4 MB, 2000 baris, maksimal 2000 baris per konfirmasi.
- File asli tidak disimpan di server; setelah selesai, hapus file export-nya karena isinya secret polos.

## Environment

| Variable | Arti |
|---|---|
| `DB_HOST` `DB_PORT` `DB_NAME` `DB_USER` `DB_PASS` | koneksi MySQL |
| `APP_PORT` | port HTTP aplikasi (default 8790) |
| `APP_URL` | base URL, dipakai untuk link absolut |
| `SESSION_TTL_HOURS` | umur sesi (default 168 = 7 hari) |
| `COOKIE_SECURE` | `1` saat di belakang HTTPS. **Wajib 1 di produksi** |
| `ENCRYPTION_KEY` | base64 dari 32 byte acak. Kunci enkripsi secret |
| `INVITE_CODE` | kalau diisi, pendaftaran setelah user pertama wajib kode ini |

Buat kunci: `openssl rand -base64 32`.

## Model keamanan

- Password: argon2id (Bun.password), minimum 12 karakter.
- Sesi: token 32 byte acak, yang disimpan hanya SHA-256-nya; cookie `HttpOnly`, `SameSite=Lax`, `Secure` bila `COOKIE_SECURE=1`.
- CSRF: double-submit untuk form anonim, token per sesi untuk form login.
- Login: maksimum 8 percobaan gagal lalu terkunci 15 menit (tersimpan di DB, bukan memori).
- Otorisasi: setiap query entri selalu `WHERE user_id = ?`; entri milik user lain menghasilkan 404.
- Header: CSP tanpa `unsafe-inline` untuk script, `X-Frame-Options: DENY`, `nosniff`, `no-store`.
- `Cache-Control: no-store` di semua response supaya kode TOTP tidak masuk cache browser/proxy.

Batasan yang diketahui:

- Lockout login dihitung per akun, bukan per IP. Orang yang tahu email bisa sengaja salah password untuk mengunci akun itu sementara; belum ada throttle per IP.
- Belum ada 2FA untuk login aplikasi itu sendiri (lihat daftar berikutnya).

## Deploy ke server luar

1. Siapkan MySQL (5.7 atau 8.0), buat database + user terbatas:
   ```sql
   CREATE DATABASE factorauth CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   CREATE USER 'factorauth'@'localhost' IDENTIFIED BY '...';
   GRANT SELECT,INSERT,UPDATE,DELETE,CREATE,ALTER,INDEX,REFERENCES,DROP ON factorauth.* TO 'factorauth'@'localhost';
   ```
2. `bun install --frozen-lockfile && bun run migrate`
3. Isi `.env` produksi: `ENCRYPTION_KEY` baru (`openssl rand -base64 32`), `COOKIE_SECURE=1`, `INVITE_CODE` diisi, kredensial DB produksi.
4. Jalankan di belakang nginx + TLS:
   ```nginx
   location / {
     proxy_pass http://127.0.0.1:8790;
     proxy_set_header Host $host;
     proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
     proxy_set_header X-Forwarded-Proto $scheme;
   }
   ```
5. systemd unit sederhana:
   ```ini
   [Unit]
   Description=factorauth
   After=network.target mysql.service

   [Service]
   WorkingDirectory=/srv/factorauth
   ExecStart=/usr/local/bin/bun run src/index.tsx
   EnvironmentFile=/srv/factorauth/.env
   Restart=always
   User=factorauth

   [Install]
   WantedBy=multi-user.target
   ```

**Backup:** `mysqldump` database **dan** simpan `ENCRYPTION_KEY` di tempat aman. Dump tanpa kunci = tumpukan ciphertext yang tidak bisa dibuka. Jangan pernah menyalin direktori `data/` MySQL saat server hidup.

**Rotasi kunci:** `ENCRYPTION_KEY` tidak bisa diganti begitu saja; semua baris harus didekripsi dengan kunci lama lalu dienkripsi ulang. Kalau kunci hilang, secret hilang permanen.

## Yang belum ada (kandidat berikutnya)

- 2FA untuk aplikasi itu sendiri (passkey WebAuthn atau TOTP external) di atas password.
- Export/import terenkripsi untuk cadangan offline.
- Audit log perubahan entri.
- Hard delete setelah sekian lama di tempat sampah (belum ada soft delete).

## Lisensi

MIT. Lihat `LICENSE`. Kode pihak lain yang ikut dibundel (jsQR) dicatat di
`THIRD_PARTY_NOTICES.md`.
