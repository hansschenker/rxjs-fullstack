import type { AuthUser } from '../auth/types';
import type { ViewChild } from '../jsx/runtime';

const AuthNav = (): ViewChild => (
  <nav>
    <a href="/login">Login</a> {' · '} <a href="/register">Register</a>
  </nav>
);

export const LoginPage = ({ message }: { readonly message: string | undefined }): ViewChild => (
  <main>
    <h1>RxJS Fullstack Login</h1>
    <AuthNav />
    {message ? <p>{message}</p> : null}
    <form method="post" action="/auth/login">
      <p>
        <label>
          Email
          <input name="email" type="email" autocomplete="email" required />
        </label>
      </p>
      <p>
        <label>
          Password
          <input
            name="password"
            type="password"
            autocomplete="current-password"
            minlength="12"
            maxlength="128"
            required
          />
        </label>
      </p>
      <button type="submit">Login</button>
    </form>
  </main>
);

export const RegisterPage = ({ message }: { readonly message: string | undefined }): ViewChild => (
  <main>
    <h1>RxJS Fullstack Register</h1>
    <AuthNav />
    {message ? <p>{message}</p> : null}
    <form method="post" action="/auth/register">
      <p>
        <label>
          Email
          <input name="email" type="email" autocomplete="email" required />
        </label>
      </p>
      <p>
        <label>
          Password
          <input
            name="password"
            type="password"
            autocomplete="new-password"
            minlength="12"
            maxlength="128"
            required
          />
        </label>
      </p>
      <button type="submit">Create account</button>
    </form>
  </main>
);

export interface AccountPageProps {
  readonly user: AuthUser;
  readonly section: string;
  readonly csrfToken: string | undefined;
}

export const AccountPage = ({ user, section, csrfToken }: AccountPageProps): ViewChild => (
  <main>
    <h1>RxJS Fullstack Account</h1>
    <p>Authenticated as {user.email}.</p>
    <p>Protected section: {section}</p>
    {csrfToken ? (
      <form method="post" action="/auth/logout">
        <input name="csrf" type="hidden" value={csrfToken} />
        <button type="submit">Logout</button>
      </form>
    ) : (
      <p>The CSRF companion cookie is missing; sign in again to log out safely.</p>
    )}
  </main>
);
