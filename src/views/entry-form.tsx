import { Layout } from "./layout.tsx";
import type { SessionUser } from "../auth.ts";

export interface EntryFormValues {
  id?: number;
  label?: string;
  issuer?: string;
  account?: string;
  algo?: string;
  digits?: number;
  period?: number;
  notes?: string;
}

export function EntryFormPage(props: {
  user: SessionUser;
  csrf: string;
  mode: "new" | "edit";
  values?: EntryFormValues;
  error?: string;
}) {
  const v = props.values ?? {};
  const isNew = props.mode === "new";
  return (
    <Layout title={isNew ? "Kunci baru" : "Edit kunci"} user={props.user} csrf={props.csrf} active="new">
      <div class="page-head">
        <div>
          <h1>{isNew ? "Kunci baru" : "Edit kunci"}</h1>
          <p class="muted">
            {isNew
              ? "Scan QR, tempel URI otpauth, atau isi manual."
              : "Kosongkan secret kalau tidak ingin menggantinya."}
          </p>
        </div>
        <a href="/vault" class="btn btn-ghost">
          Batal
        </a>
      </div>

      {props.error ? (
        <p class="alert alert-error" role="alert">
          {props.error}
        </p>
      ) : null}

      {isNew ? (
        <section class="card">
          <h2>Impor dari QR</h2>
          <p class="muted small">
            Gambar diproses di browser ini. Tidak ada file yang diunggah ke server.
          </p>
          <div class="row wrap">
            <label class="btn btn-ghost file-btn">
              Pilih gambar QR
              <input
                type="file"
                id="qr-file"
                accept="image/*"
                class="sr-only"
                aria-label="Pilih gambar QR"
              />
            </label>
            <button type="button" class="btn btn-ghost" id="qr-camera">
              Pakai kamera
            </button>
            <span class="muted small" id="qr-status" aria-live="polite"></span>
          </div>
          <video id="qr-video" class="qr-video" playsinline muted hidden></video>
          <details class="paste">
            <summary>Tempel URI otpauth</summary>
            <div class="row">
              <input type="text" id="otpauth-input" placeholder="otpauth://totp/…" autocomplete="off" />
              <button type="button" class="btn btn-ghost" id="otpauth-apply">
                Isi form
              </button>
            </div>
          </details>
        </section>
      ) : null}

      <form method="post" action={isNew ? "/entries" : `/entries/${v.id}`} class="card stack" id="entry-form">
        <input type="hidden" name="_csrf" value={props.csrf} />
        <div class="grid-2">
          <label class="field">
            <span>Layanan (issuer)</span>
            <input type="text" name="issuer" value={v.issuer ?? ""} maxlength={100} placeholder="GitHub" id="f-issuer" />
          </label>
          <label class="field">
            <span>Label</span>
            <input type="text" name="label" value={v.label ?? ""} maxlength={100} placeholder="GitHub pribadi" required id="f-label" />
          </label>
        </div>
        <label class="field">
          <span>Akun</span>
          <input
            type="text"
            name="account"
            value={v.account ?? ""}
            maxlength={191}
            placeholder="nama@email.com"
            autocomplete="off"
            id="f-account"
          />
        </label>
        <label class="field">
          <span>Secret {isNew ? "" : "(baru, opsional)"}</span>
          <input
            type="text"
            name="secret"
            required={isNew}
            autocomplete="off"
            spellcheck={false}
            class="mono"
            placeholder="JBSWY3DPEHPK3PXP"
            id="f-secret"
          />
          <small class="hint">Base32. Disimpan terenkripsi, tidak pernah dikirim balik ke browser.</small>
        </label>
        <div class="grid-3">
          <label class="field">
            <span>Algoritma</span>
            <select name="algorithm" id="f-algorithm">
              <option value="SHA1" selected={v.algo === "SHA1" || v.algo === undefined}>SHA1</option>
              <option value="SHA256" selected={v.algo === "SHA256"}>SHA256</option>
              <option value="SHA512" selected={v.algo === "SHA512"}>SHA512</option>
            </select>
          </label>
          <label class="field">
            <span>Digit</span>
            <select name="digits" id="f-digits">
              <option value="6" selected={(v.digits ?? 6) === 6}>6</option>
              <option value="8" selected={v.digits === 8}>8</option>
            </select>
          </label>
          <label class="field">
            <span>Periode (detik)</span>
            <input type="number" name="period" min="10" max="300" value={v.period ?? 30} id="f-period" />
          </label>
        </div>
        <label class="field">
          <span>Catatan (opsional)</span>
          <textarea name="notes" rows={3} maxlength={2000}>{v.notes ?? ""}</textarea>
        </label>
        <div class="row end">
          <button type="submit" class="btn btn-primary">
            {isNew ? "Simpan kunci" : "Simpan perubahan"}
          </button>
        </div>
      </form>

      {isNew ? <script src="/jsQR.js" defer></script> : null}
      <script src="/entry-form.js" defer></script>
    </Layout>
  );
}
