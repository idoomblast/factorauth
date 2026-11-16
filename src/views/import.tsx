import { Layout } from "./layout.tsx";
import type { SessionUser } from "../auth.ts";
import type { DuplicateReason, ParsedRow } from "../xlsx-import.ts";

function maskSecret(secret: string): string {
  if (secret.length <= 6) {
    return "•".repeat(secret.length);
  }
  return `${secret.slice(0, 4)}••••${secret.slice(-2)}`;
}

export function ImportUploadPage(props: { user: SessionUser; csrf: string; error?: string }) {
  return (
    <Layout title="Impor xlsx" user={props.user} csrf={props.csrf} active="import">
      <div class="page-head">
        <div>
          <h1>Impor dari Excel</h1>
          <p class="muted">Pindahkan kunci dari sistem lama tanpa mengetik ulang.</p>
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

      <form
        method="post"
        action="/import/preview"
        enctype="multipart/form-data"
        class="card stack"
        id="import-form"
      >
        <input type="hidden" name="_csrf" value={props.csrf} />
        <label class="dropzone" id="dropzone" for="import-file">
          <input
            id="import-file"
            type="file"
            name="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            required
            class="sr-only"
          />
          <span class="dz-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.6">
              <path d="M7 3.5h7l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19V5a1.5 1.5 0 0 1 1-1.5Z" />
              <path d="M13.5 3.8V8h4.2" />
              <path d="M12 17v-5" />
              <path d="m9.8 13.6 2.2-2.2 2.2 2.2" />
            </svg>
          </span>
          <span class="dz-title" id="dz-title">Tarik file .xlsx ke sini</span>
          <span class="dz-sub" id="dz-sub">
            atau <span class="dz-link">pilih dari komputer</span>
          </span>
          <span class="dz-file" id="dz-file" hidden></span>
          <span class="dz-error" id="dz-error" role="alert" hidden></span>
        </label>
        <p class="hint center">Sheet pertama dibaca. Maksimal 4 MB dan 2000 baris.</p>
        <details class="paste">
          <summary>Format yang didukung</summary>
          <div class="format-help">
            <p>
              <strong>Tanpa header</strong> (format export lama): kolom <code>id</code>,{" "}
              <code>label</code>, <code>issuer</code>, <code>secret</code>. Kolom id diabaikan.
            </p>
            <p>
              <strong>Dengan header</strong>: kolom dikenali dari namanya, mis.{" "}
              <code>Label</code>, <code>Issuer</code>, <code>Account</code>, <code>Secret</code>,{" "}
              <code>Algorithm</code>, <code>Digits</code>, <code>Period</code>, <code>Notes</code>.
            </p>
            <p class="muted small">
              Secret boleh ditulis berkelompok (<code>JBSW Y3DP EHPK 3PXP</code>) maupun menyambung.
            </p>
          </div>
        </details>
        <div class="row end">
          <button type="submit" class="btn btn-primary" id="import-submit">
            Baca file
          </button>
        </div>
      </form>

      <section class="card">
        <h2>Sebelum impor</h2>
        <ul class="plain-list">
          <li>Secret dienkripsi ulang di sini; file tidak disimpan di server.</li>
          <li>Baris dengan secret yang sudah ada di vault akan dilewati, jadi aman diulang.</li>
          <li>
            Dua akun berbeda boleh memakai secret yang sama; yang dianggap duplikat hanya baris
            dengan secret <em>dan</em> label/issuer/akun yang sama persis.
          </li>
          <li>Proses baca hanya memuat sheet pertama dan mengabaikan styling.</li>
        </ul>
      </section>
      <script src="/import.js" defer></script>
    </Layout>
  );
}

export interface PreviewRow extends ParsedRow {
  duplicate: DuplicateReason | null;
  duplicateLines: number[];
}

export function ImportPreviewPage(props: {
  user: SessionUser;
  csrf: string;
  sheetName: string;
  mapping: string;
  layout: string;
  rows: PreviewRow[];
  skipped: number;
  payload: string;
}) {
  const counts = {
    ready: props.rows.filter((row) => !row.error && !row.duplicate).length,
    vault: props.rows.filter((row) => row.duplicate === "vault").length,
    file: props.rows.filter((row) => row.duplicate === "file").length,
    bad: props.rows.filter((row) => row.error).length,
  };
  return (
    <Layout title="Pratinjau impor" user={props.user} csrf={props.csrf} active="import">
      <div class="page-head">
        <div>
          <h1>Pratinjau</h1>
          <p class="muted">
            {props.sheetName} · {props.layout === "header" ? "dengan header" : "tanpa header"} ·{" "}
            {props.mapping}
          </p>
        </div>
        <a href="/import" class="btn btn-ghost">
          Ganti file
        </a>
      </div>

      <div class="summary-grid">
        <div class="stat">
          <span class="stat-value">{props.rows.length}</span>
          <span class="stat-label">baris dibaca</span>
        </div>
        <div class="stat stat-ok">
          <span class="stat-value">{counts.ready}</span>
          <span class="stat-label">siap diimpor</span>
        </div>
        <div class="stat">
          <span class="stat-value">{counts.vault}</span>
          <span class="stat-label">sudah di vault</span>
        </div>
        <div class="stat stat-warn">
          <span class="stat-value">{counts.file}</span>
          <span class="stat-label">duplikat di file</span>
        </div>
        <div class="stat stat-bad">
          <span class="stat-value">{counts.bad}</span>
          <span class="stat-label">bermasalah</span>
        </div>
      </div>

      {counts.file > 0 ? (
        <p class="alert alert-info">
          {counts.file} baris persis sama dengan baris lain di file ini (secret, label, issuer, dan
          akun identik), jadi dilewati. Satu salinannya tetap diimpor.
        </p>
      ) : null}

      {props.skipped > 0 ? (
        <p class="muted small">{props.skipped} baris kosong dilewati.</p>
      ) : null}

      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>#</th>
              <th>Label</th>
              <th>Issuer</th>
              <th class="col-account">Akun</th>
              <th>Secret</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {props.rows.map((row) => (
              <tr class={row.error ? "row-bad" : row.duplicate ? "row-dim" : ""}>
                <td class="mono small">{row.line}</td>
                <td>{row.label || <span class="muted">-</span>}</td>
                <td>{row.issuer || <span class="muted">-</span>}</td>
                <td class="col-account">{row.account || <span class="muted">-</span>}</td>
                <td class="mono small">{maskSecret(row.secret)}</td>
                <td>
                  {row.error ? (
                    <span class="badge badge-bad">{row.error}</span>
                  ) : row.duplicate === "vault" ? (
                    <span class="badge">sudah di vault</span>
                  ) : row.duplicate === "file" ? (
                    <span class="badge">kembar baris {row.duplicateLines.join(", ")}</span>
                  ) : (
                    <span class="badge badge-ok">siap</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form method="post" action="/import/confirm" class="row end sticky-actions">
        <input type="hidden" name="_csrf" value={props.csrf} />
        <textarea name="payload" hidden>
          {props.payload}
        </textarea>
        <a href="/vault" class="btn btn-ghost">
          Batal
        </a>
        <button type="submit" class="btn btn-primary" disabled={counts.ready === 0}>
          Impor {counts.ready} kunci
        </button>
      </form>
    </Layout>
  );
}
