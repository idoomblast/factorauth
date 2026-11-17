import type { FC, PropsWithChildren } from "hono/jsx";
import type { SessionUser } from "../auth.ts";

type ActiveNav = "vault" | "import" | "new" | null;

const IconVault: FC = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
    <rect x="4" y="10" width="16" height="10" rx="2.5" />
    <path d="M8 10V7.5a4 4 0 0 1 8 0V10" />
    <circle cx="12" cy="15" r="1.3" fill="currentColor" stroke="none" />
  </svg>
);

const IconUpload: FC = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
    <path d="M12 16V4" />
    <path d="m7.5 8.5 4.5-4.5 4.5 4.5" />
    <path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" />
  </svg>
);

const IconLogout: FC = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
    <path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H15" />
    <path d="M10 8 6 12l4 4" />
    <path d="M6 12h9" />
  </svg>
);

export const Layout: FC<
  PropsWithChildren<{
    title: string;
    user?: SessionUser | null;
    csrf?: string;
    bodyClass?: string;
    active?: ActiveNav;
  }>
> = (props) => {
  const active = props.active ?? null;
  return (
    <html lang="id">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="robots" content="noindex, nofollow" />
        <meta name="referrer" content="same-origin" />
        <title>{props.title} · factorauth</title>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="stylesheet" href="/style.css" />
      </head>
      <body class={props.bodyClass ?? ""}>
        <a class="skip-link" href="#main">
          Lewati ke konten
        </a>
        <header class="topbar">
          <div class="topbar-inner">
            <a class="brand" href="/" aria-label="factorauth">
              <span class="brand-mark" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8">
                  <rect x="4" y="10" width="16" height="10" rx="2.5" />
                  <path d="M8 10V7.5a4 4 0 0 1 8 0V10" />
                  <circle cx="12" cy="15" r="1.3" fill="currentColor" stroke="none" />
                </svg>
              </span>
              <span class="brand-name">factorauth</span>
            </a>
            {props.user ? (
              <nav class="topnav" aria-label="Navigasi utama">
                <a
                  href="/vault"
                  class={`nav-pill${active === "vault" ? " is-active" : ""}`}
                  aria-current={active === "vault" ? "page" : undefined}
                >
                  <IconVault />
                  <span>Vault</span>
                </a>
                <a
                  href="/import"
                  class={`nav-pill${active === "import" ? " is-active" : ""}`}
                  aria-label="Impor dari Excel"
                  aria-current={active === "import" ? "page" : undefined}
                >
                  <IconUpload />
                  <span>Impor</span>
                </a>
                <form method="post" action="/logout" class="inline">
                  <input type="hidden" name="_csrf" value={props.csrf ?? ""} />
                  <button type="submit" class="nav-icon" aria-label="Keluar" title="Keluar">
                    <IconLogout />
                  </button>
                </form>
              </nav>
            ) : null}
          </div>
        </header>
        <main class="shell" id="main" tabindex={-1}>
          {props.children}
        </main>
        <footer class="footer">
          <div class="footer-inner">
            <span>Secret tersimpan terenkripsi AES-256-GCM. Kode dibuat di server.</span>
          </div>
        </footer>
      </body>
    </html>
  );
};
