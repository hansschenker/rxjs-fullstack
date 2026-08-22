import { firstValueFrom } from 'rxjs';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';

import { parseAuthCredentials } from '../auth/credentials';
import {
  AuthCsrfError,
  AuthEmailAlreadyRegisteredError,
  AuthInvalidCredentialsError,
  AUTH_SESSION_TTL_MS,
  type AuthService,
} from '../auth/service';
import { constantTimeEqualString } from '../auth/password';
import type { ResolvedAuthSession } from '../auth/types';

export const SESSION_COOKIE_NAME = 'id';
export const CSRF_COOKIE_NAME = 'csrf';

const cookieSecurity = (context: Context): boolean =>
  new URL(context.req.url).protocol === 'https:';

const setAuthCookies = (
  context: Context,
  sessionToken: string,
  csrfToken: string,
): void => {
  const secure = cookieSecurity(context);
  const maxAge = Math.floor(AUTH_SESSION_TTL_MS / 1_000);
  setCookie(context, SESSION_COOKIE_NAME, sessionToken, {
    path: '/',
    httpOnly: true,
    secure,
    sameSite: 'Strict',
    maxAge,
  });
  setCookie(context, CSRF_COOKIE_NAME, csrfToken, {
    path: '/',
    httpOnly: false,
    secure,
    sameSite: 'Strict',
    maxAge,
  });
};

const clearAuthCookies = (context: Context): void => {
  const secure = cookieSecurity(context);
  deleteCookie(context, SESSION_COOKIE_NAME, { path: '/', secure });
  deleteCookie(context, CSRF_COOKIE_NAME, { path: '/', secure });
};

const mutationIsSameOrigin = (request: Request): boolean => {
  const expectedOrigin = new URL(request.url).origin;
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  return origin === expectedOrigin && fetchSite !== 'cross-site';
};

const credentialsFromForm = async (context: Context) => {
  const form = await context.req.formData();
  return parseAuthCredentials({
    email: form.get('email'),
    password: form.get('password'),
  });
};

const noStore = (context: Context): void => {
  context.header('cache-control', 'no-store');
};

export const resolveRequestAuth = async (
  context: Context,
  authService: AuthService,
): Promise<ResolvedAuthSession | null> =>
  firstValueFrom(
    authService.resolveSession$(
      getCookie(context, SESSION_COOKIE_NAME),
      getCookie(context, CSRF_COOKIE_NAME),
      { signal: context.req.raw.signal },
    ),
  );

export interface CreateAuthHttpOptions {
  readonly authService: AuthService;
}

export const createAuthHttp = ({ authService }: CreateAuthHttpOptions) => {
  const auth = new Hono();

  auth.post('/register', async (context) => {
    noStore(context);
    if (!mutationIsSameOrigin(context.req.raw)) {
      return context.text('Cross-site authentication request rejected.', 403);
    }

    const credentials = await credentialsFromForm(context);
    if (!credentials) {
      return context.redirect('/register?error=invalid', 303);
    }

    try {
      await firstValueFrom(
        authService.register$(credentials, { signal: context.req.raw.signal }),
      );
      return context.redirect('/login?registered=1', 303);
    } catch (error) {
      if (error instanceof AuthEmailAlreadyRegisteredError) {
        return context.redirect('/register?error=exists', 303);
      }
      return context.text('Registration failed.', 500);
    }
  });

  auth.post('/login', async (context) => {
    noStore(context);
    if (!mutationIsSameOrigin(context.req.raw)) {
      return context.text('Cross-site authentication request rejected.', 403);
    }

    const credentials = await credentialsFromForm(context);
    if (!credentials) {
      return context.redirect('/login?error=invalid', 303);
    }

    try {
      const session = await firstValueFrom(
        authService.login$(credentials, { signal: context.req.raw.signal }),
      );
      setAuthCookies(context, session.sessionToken, session.csrfToken);
      return context.redirect('/account/profile', 303);
    } catch (error) {
      if (error instanceof AuthInvalidCredentialsError) {
        return context.redirect('/login?error=invalid', 303);
      }
      return context.text('Login failed.', 500);
    }
  });

  auth.post('/logout', async (context) => {
    noStore(context);
    if (!mutationIsSameOrigin(context.req.raw)) {
      return context.text('Cross-site authentication request rejected.', 403);
    }

    const form = await context.req.formData();
    const formCsrf = form.get('csrf');
    const cookieCsrf = getCookie(context, CSRF_COOKIE_NAME);
    const sessionToken = getCookie(context, SESSION_COOKIE_NAME);
    if (
      typeof formCsrf !== 'string' ||
      !cookieCsrf ||
      !constantTimeEqualString(formCsrf, cookieCsrf)
    ) {
      return context.text('Invalid CSRF token.', 403);
    }

    try {
      await firstValueFrom(
        authService.logout$(sessionToken, cookieCsrf, {
          signal: context.req.raw.signal,
        }),
      );
      clearAuthCookies(context);
      return context.redirect('/login?loggedOut=1', 303);
    } catch (error) {
      if (error instanceof AuthCsrfError) {
        return context.text('Invalid CSRF token.', 403);
      }
      return context.text('Logout failed.', 500);
    }
  });

  auth.get('/session', async (context) => {
    noStore(context);
    const session = await resolveRequestAuth(context, authService);
    return context.json({ user: session?.user ?? null });
  });

  return auth;
};
