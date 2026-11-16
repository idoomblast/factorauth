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

  return (
    <Layout title="Vault" user={props.user} csrf={props.csrf} active="vault">
      <div class="page-head">
        <div>
          <h1>Vault</h1>
          <p class="muted">
            {props.q ? `${props.total} hasil untuk “${props.q}”` : `${props.total} kunci`} ·{" "}
            {props.user.email}
          </p>
        </div>
        <div class="head-actions">
          {props.total > 0 ? (
            <form method="post" action="/vault/export" class="inline">
              <input type="hidden" name="_csrf" value={props.csrf} />
              <button type="submit" class="btn btn-ghost" title="Unduh semua kunci sebagai .xlsx">
                Ekspor .xlsx
              </button>
            </form>
          ) : null}
          {props.entries.length > 0 ? (
            <a href="/entries/new" class="btn btn-primary">
              + Kunci baru
            </a>
          ) : null}
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
          <button type="submit" class="btn btn-ghost btn-sm">
            Cari
          </button>
          {props.q ? (
            <a href="/vault" class="btn btn-ghost btn-sm">
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
            <a href="/vault" class="btn btn-ghost">
              Tampilkan semua
            </a>
          </section>
        ) : (
          <section class="card empty">
            <h2>Belum ada kunci</h2>
            <p class="muted">
              Scan QR dari layanan yang mau kamu amankan, atau tempel URI <code>otpauth://</code>.
            </p>
            <a href="/entries/new" class="btn btn-primary">
              Tambah kunci pertama
            </a>
          </section>
        )
      ) : (
        <ul class="vault" id="vault-list">
          {props.entries.map((entry) => (
            <li
              class="entry"
              data-id={entry.id}
              data-period={entry.period}
              data-digits={entry.digits}
              data-remaining={entry.remaining}
            >
              <div class="entry-main">
                <div class="entry-id">
                  <span class="entry-issuer">{entry.issuer || entry.label}</span>
                  {entry.issuer && entry.label !== entry.issuer ? (
                    <span class="entry-label">{entry.label}</span>
                  ) : null}
                  <span class="entry-account">{entry.account}</span>
                </div>
                <button
                  type="button"
                  class="code"
                  data-copy
                  aria-label={`Salin kode ${entry.issuer || entry.label}`}
                >
                  <span class="code-digits">{formatCode(entry.code)}</span>
                  <span class="code-tip" aria-hidden="true">Klik untuk salin kode</span>
                  <span class="code-tip code-tip-copied" aria-hidden="true">Tersalin!</span>
                </button>
              </div>
              <div class="entry-meta">
                <div class="timer" aria-hidden="true">
                  <span class="timer-bar" style={`width:${(entry.remaining / entry.period) * 100}%`}></span>
                </div>
                <span class="timer-seconds">{entry.remaining}s</span>
                <span class="entry-spec">
                  {entry.algo} · {entry.digits} digit · {entry.period}s
                </span>
                <div class="entry-actions">
                  <a class="btn btn-ghost btn-sm" href={`/entries/${entry.id}/edit`}>
                    Edit
                  </a>
                  <form method="post" action={`/entries/${entry.id}/delete`} class="inline" data-confirm="Hapus kunci ini? Tindakan ini tidak bisa dibatalkan.">
                    <input type="hidden" name="_csrf" value={props.csrf} />
                    <button type="submit" class="btn btn-danger btn-sm">
                      Hapus
                    </button>
                  </form>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {props.totalPages > 1 ? (
        <nav class="pager" aria-label="Navigasi halaman vault">
          {props.page > 1 ? (
            <a class="btn btn-ghost btn-sm" href={hrefFor(props.page - 1)} rel="prev">
              ‹ Sebelumnya
            </a>
          ) : (
            <span class="btn btn-ghost btn-sm is-disabled" aria-hidden="true">
              ‹ Sebelumnya
            </span>
          )}
          <span class="pager-info">
            Menampilkan {from}–{to} dari {props.total} · halaman {props.page}/{props.totalPages}
          </span>
          {props.page < props.totalPages ? (
            <a class="btn btn-ghost btn-sm" href={hrefFor(props.page + 1)} rel="next">
              Berikutnya ›
            </a>
          ) : (
            <span class="btn btn-ghost btn-sm is-disabled" aria-hidden="true">
              Berikutnya ›
            </span>
          )}
        </nav>
      ) : null}

      <p class="sr-only" id="copy-status" role="status" aria-live="polite"></p>
      <script src="/app.js" defer></script>
    </Layout>
  );
}
