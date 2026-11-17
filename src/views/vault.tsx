import type { FC } from "hono/jsx";
import { Layout } from "./layout.tsx";
import type { SessionUser } from "../auth.ts";

export interface VaultEntryView {
  id: number;
  label: string;
  issuer: string;
  account: string;
  algo: string;
  digits: number;
  period: number;
  code: string;
  remaining: number;
}

export function formatCode(code: string): string {
  if (code.length === 6) {
    return `${code.slice(0, 3)} ${code.slice(3)}`;
  }
  if (code.length === 8) {
    return `${code.slice(0, 4)} ${code.slice(4)}`;
  }
  return code;
}

const IconCopy: FC = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="9" y="9" width="11" height="11" rx="2.5" />
    <path d="M15.5 6.2V5.5A2.5 2.5 0 0 0 13 3H5.5A2.5 2.5 0 0 0 3 5.5V13a2.5 2.5 0 0 0 2.5 2.5h.7" />
  </svg>
);

const IconMore: FC = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
    <circle cx="5.5" cy="12" r="1.7" />
    <circle cx="12" cy="12" r="1.7" />
    <circle cx="18.5" cy="12" r="1.7" />
  </svg>
);

/** Human label used for every accessible name in a row. */
function entryName(entry: VaultEntryView): string {
  const name = entry.issuer || entry.label || "kunci";
  return entry.account ? `${name} ${entry.account}` : name;
}

/** Six digits, SHA1 and 30s is the norm; only deviations earn a badge. */
function isDefaultSpec(entry: VaultEntryView): boolean {
  return entry.algo === "SHA1" && entry.digits === 6 && entry.period === 30;
}

/** Amber from 5s, red from 2s. app.js applies the same thresholds. */
function timerState(remaining: number): string {
  if (remaining <= 2) return "is-critical";
  if (remaining <= 5) return "is-warning";
  return "";
}

export function VaultPage(props: {
  user: SessionUser;
  csrf: string;
  entries: VaultEntryView[];
  total: number;
  page: number;
  totalPages: number;
  perPage: number;
  q: string;
  flash?: string;
}) {
  const hrefFor = (target: number): string => {
    const params = new URLSearchParams();
    if (props.q) params.set("q", props.q);
    if (target > 1) params.set("page", String(target));
    const query = params.toString();
    return query ? `/vault?${query}` : "/vault";
  };
  const from = props.entries.length === 0 ? 0 : (props.page - 1) * props.perPage + 1;
  const to = props.entries.length === 0 ? 0 : from + props.entries.length - 1;
  const showExport = props.total > 0 || props.q !== "";

  return (
    <Layout title="Vault" user={props.user} csrf={props.csrf} active="vault" bodyClass="vault-page">
      <div class="page-head">
        <div class="page-head-text">
          <h1>Vault</h1>
          <p class="page-sub">
            <span>{props.q ? `${props.total} hasil untuk “${props.q}”` : `${props.total} kunci`}</span>
            <span class="page-sub-sep" aria-hidden="true">
              ·
            </span>
            <span>Secret terenkripsi di server, kode dibuat saat diminta.</span>
          </p>
        </div>
        <div class="head-actions">
          {showExport ? (
            <form method="post" action="/vault/export" class="inline">
              <input type="hidden" name="_csrf" value={props.csrf} />
              <button
                type="submit"
                class="btn btn-ghost"
                title="Unduh seluruh vault sebagai .xlsx — semua kunci, bukan hanya halaman ini"
              >
                Ekspor .xlsx<span class="sr-only"> (seluruh vault)</span>
              </button>
            </form>
          ) : null}
          <a href="/entries/new" class="btn btn-primary">
            + Kunci baru
          </a>
        </div>
      </div>

      {props.flash ? (
        <p class="alert alert-ok" role="status">
          {props.flash}
        </p>
      ) : null}

      {props.total > 0 || props.q ? (
        <form method="get" action="/vault" class="search-row" role="search">
          <input
            type="search"
            id="vault-search"
            name="q"
            value={props.q}
            placeholder="Cari layanan, akun, atau catatan…"
            autocomplete="off"
            aria-label="Cari kunci"
          />
          <button type="submit" class="btn btn-ghost">
            Cari
          </button>
          {props.q ? (
            <a href="/vault" class="btn btn-ghost">
              Reset
            </a>
          ) : null}
        </form>
      ) : null}

      {props.entries.length === 0 ? (
        props.q ? (
          <section class="card empty">
            <h2>Tidak ada hasil</h2>
            <p class="muted">Tidak ada kunci yang cocok dengan “{props.q}”.</p>
            <div class="empty-actions">
              <a href="/vault" class="btn btn-ghost">
                Tampilkan semua
              </a>
              <a href="/entries/new" class="btn btn-ghost">
                Tambah kunci
              </a>
            </div>
          </section>
        ) : (
          <section class="card empty">
            <h2>Belum ada kunci</h2>
            <p class="muted">
              Scan QR dari layanan yang mau kamu amankan, atau tempel URI <code>otpauth://</code>.
            </p>
            <div class="empty-actions">
              <a href="/entries/new" class="btn btn-ghost">
                Tambah kunci
              </a>
            </div>
          </section>
        )
      ) : (
        <ul class="vault" id="vault-list" aria-label="Daftar kunci">
          {props.entries.map((entry) => {
            const name = entryName(entry);
            const formatted = formatCode(entry.code);
            const seconds = Math.max(0, Math.ceil(entry.remaining));
            const state = timerState(entry.remaining);
            return (
              <li
                class={`entry${state ? ` ${state}` : ""}`}
                data-id={entry.id}
                data-period={entry.period}
                data-digits={entry.digits}
                data-remaining={entry.remaining}
                data-name={name}
              >
                <div class="entry-id">
                  <span class="entry-line">
                    <span class="entry-issuer">{entry.issuer || entry.label}</span>
                    {isDefaultSpec(entry) ? null : (
                      <span class="badge entry-spec">
                        {entry.algo} · {entry.digits} digit · {entry.period}s
                      </span>
                    )}
                  </span>
                  <span class="entry-sub">
                    {entry.issuer && entry.label && entry.label !== entry.issuer ? (
                      <>
                        <span class="entry-label">{entry.label}</span>
                        <span class="entry-sep" aria-hidden="true">
                          ·
                        </span>
                      </>
                    ) : null}
                    <span class="entry-account">{entry.account || "Tanpa akun"}</span>
                  </span>
                </div>

                <div class="entry-code">
                  <button
                    type="button"
                    class="code"
                    data-copy
                    aria-label={`Salin kode ${name}: ${formatted}`}
                  >
                    <span class="code-digits">{formatted}</span>
                    <span class="code-hint" aria-hidden="true">
                      <IconCopy />
                    </span>
                    <span class="code-tip" aria-hidden="true">
                      Tersalin!
                    </span>
                  </button>
                  <span class="timer-seconds" aria-hidden="true">
                    {seconds}s
                  </span>
                  <span class="timer" aria-hidden="true">
                    <span
                      class="timer-bar"
                      style={`width:${(entry.remaining / entry.period) * 100}%`}
                    ></span>
                  </span>
                  <span class="sr-only" data-remaining-sr>
                    Sisa {seconds} detik
                  </span>
                </div>

                <details class="entry-menu">
                  <summary aria-label={`Aksi untuk ${name}`}>
                    <IconMore />
                  </summary>
                  <div class="menu-panel">
                    <a class="menu-item" href={`/entries/${entry.id}/edit`} aria-label={`Edit ${name}`}>
                      Edit
                    </a>
                    <form
                      method="post"
                      action={`/entries/${entry.id}/delete`}
                      class="menu-form"
                      data-confirm="Hapus kunci ini? Tindakan ini tidak bisa dibatalkan."
                    >
                      <input type="hidden" name="_csrf" value={props.csrf} />
                      <button type="submit" class="menu-item menu-item-danger" aria-label={`Hapus ${name}`}>
                        Hapus
                      </button>
                    </form>
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      )}

      {props.totalPages > 1 ? (
        <nav class="pager" aria-label="Navigasi halaman vault">
          {props.page > 1 ? (
            <a class="btn btn-ghost pager-btn" href={hrefFor(props.page - 1)} rel="prev">
              ‹ Sebelumnya
            </a>
          ) : (
            <button type="button" class="btn btn-ghost pager-btn" disabled>
              ‹ Sebelumnya<span class="sr-only"> (tidak tersedia)</span>
            </button>
          )}
          <span class="pager-info">
            Menampilkan {from}–{to} dari {props.total} · halaman {props.page}/{props.totalPages}
          </span>
          {props.page < props.totalPages ? (
            <a class="btn btn-ghost pager-btn" href={hrefFor(props.page + 1)} rel="next">
              Berikutnya ›
            </a>
          ) : (
            <button type="button" class="btn btn-ghost pager-btn" disabled>
              Berikutnya ›<span class="sr-only"> (tidak tersedia)</span>
            </button>
          )}
        </nav>
      ) : null}

      <p class="sr-only" id="copy-status" role="status" aria-live="polite"></p>
      <script src="/app.js" defer></script>
    </Layout>
  );
}
