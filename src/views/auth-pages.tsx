import type { FC, PropsWithChildren } from "hono/jsx";
import { Layout } from "./layout.tsx";

const ErrorBox: FC<PropsWithChildren<{ show: boolean }>> = ({ show, children }) =>
  show ? (
    <p class="alert alert-error" role="alert" aria-live="polite">
      {children}
    </p>
  ) : null;

export function LoginPage(props: { csrf: string; error?: string; email?: string; notice?: string }) {
  return (
    <Layout title="Masuk">
      <section class="card card-narrow">
        <h1>Masuk</h1>
        <p class="muted">Vault 2FA kamu, terkunci di server sendiri.</p>
        {props.notice ? (
          <p class="alert alert-ok" role="status">
            {props.notice}
          </p>
        ) : null}
        <ErrorBox show={Boolean(props.error)}>{props.error}</ErrorBox>
        <form method="post" action="/login" class="stack" autocomplete="on">
          <input type="hidden" name="_csrf" value={props.csrf} />
          <label class="field">
            <span>Email</span>
            <input
              type="email"
              name="email"
              value={props.email ?? ""}
              required
              autocomplete="username"
              inputmode="email"
            />
          </label>
          <label class="field">
            <span>Password</span>
            <input type="password" name="password" required autocomplete="current-password" />
          </label>
          <button type="submit" class="btn btn-primary btn-block">
            Masuk
          </button>
        </form>
        <p class="muted center">
          Belum punya akun? <a href="/register">Daftar</a>
        </p>
      </section>
    </Layout>
  );
}

export function RegisterPage(props: {
  csrf: string;
  error?: string;
  email?: string;
  name?: string;
  inviteRequired: boolean;
}) {
  return (
    <Layout title="Daftar">
      <section class="card card-narrow">
        <h1>Buat akun</h1>
        <p class="muted">Satu akun, satu vault pribadi. Tidak ada data yang dibagi antar akun.</p>
        <ErrorBox show={Boolean(props.error)}>{props.error}</ErrorBox>
        <form method="post" action="/register" class="stack" autocomplete="on">
          <input type="hidden" name="_csrf" value={props.csrf} />
          <label class="field">
            <span>Nama</span>
            <input type="text" name="name" value={props.name ?? ""} maxlength={100} autocomplete="name" />
          </label>
          <label class="field">
            <span>Email</span>
            <input
              type="email"
              name="email"
              value={props.email ?? ""}
              required
              autocomplete="username"
              inputmode="email"
              maxlength={191}
            />
          </label>
          <label class="field">
            <span>Password</span>
            <input
              type="password"
              name="password"
              required
              minlength={12}
              autocomplete="new-password"
            />
            <small class="hint">Minimal 12 karakter. Pakai frasa, bukan kata tunggal.</small>
          </label>
          <label class="field">
            <span>Ulangi password</span>
            <input
              type="password"
              name="password_confirm"
              required
              minlength={12}
              autocomplete="new-password"
            />
          </label>
          {props.inviteRequired ? (
            <label class="field">
              <span>Kode undangan</span>
              <input type="text" name="invite" required autocomplete="off" />
            </label>
          ) : null}
          <button type="submit" class="btn btn-primary btn-block">
            Daftar
          </button>
        </form>
        <p class="muted center">
          Sudah punya akun? <a href="/login">Masuk</a>
        </p>
      </section>
    </Layout>
  );
}
