import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { firstValueFrom } from 'rxjs';

import {
  PBKDF2_ITERATIONS,
  createPbkdf2PasswordHasher,
  hashOpaqueToken,
} from '../src/auth/password';
import {
  AuthEmailAlreadyRegisteredError,
  createAuthService,
} from '../src/auth/service';
import { createMemoryAuthRepository } from '../src/database/memory-auth-repository';
import { createMemoryTodoRepository } from '../src/database/memory-todos-repository';
import { createPgliteApplicationRepositories } from '../src/database/pglite-application-repositories';
import { createApp } from '../src/server/app';

const assert: (condition: unknown, message: string) => asserts condition = (
  condition,
  message,
) => {
  if (!condition) {
    throw new Error(message);
  }
};

const assertEqual = (
  actual: unknown,
  expected: unknown,
  message: string,
): void => {
  if (!Object.is(actual, expected)) {
    throw new Error(
      `${message}\nExpected: ${String(expected)}\nActual: ${String(actual)}`,
    );
  }
};

const testHasher = createPbkdf2PasswordHasher({ iterations: 1_000 });
assertEqual(
  PBKDF2_ITERATIONS,
  600_000,
  'M12: production PBKDF2 policy should use 600,000 HMAC-SHA-256 iterations.',
);

const authRepository = createMemoryAuthRepository();
const authService = createAuthService({
  repository: authRepository,
  passwordHasher: testHasher,
});
const credentials = {
  email: 'user@rxjs-fullstack.test',
  password: 'observable-password',
} as const;

const pendingRegistration$ = authService.register$(credentials);
const beforeRegistration = await firstValueFrom(
  authRepository.findUserByEmail$(credentials.email),
);
assertEqual(
  beforeRegistration,
  undefined,
  'M12: constructing register$ must not create a user before subscription.',
);
const registeredUser = await firstValueFrom(pendingRegistration$);
const storedUser = await firstValueFrom(
  authRepository.findUserByEmail$(credentials.email),
);
assert(storedUser, 'M12: subscribing to register$ should persist the user.');
assert(
  storedUser.passwordHash !== credentials.password &&
    storedUser.passwordHash.startsWith('pbkdf2-sha256$1000$'),
  'M12: repositories must store a salted password derivation instead of plaintext.',
);
assertEqual(registeredUser.email, credentials.email, 'M12: registration should normalize the user identity.');
assertEqual(
  await firstValueFrom(
    authRepository.createUser$(credentials.email, 'duplicate-password-hash'),
  ),
  undefined,
  'M12: the repository create boundary should report an email conflict instead of throwing a generic persistence error.',
);

let duplicateRegistrationRejected = false;
try {
  await firstValueFrom(authService.register$(credentials));
} catch (error) {
  duplicateRegistrationRejected =
    error instanceof AuthEmailAlreadyRegisteredError;
}
assert(
  duplicateRegistrationRejected,
  'M12: duplicate registration should surface the typed already-registered result.',
);

let wrongPasswordRejected = false;
try {
  await firstValueFrom(
    authService.login$({ ...credentials, password: 'wrong-password-value' }),
  );
} catch {
  wrongPasswordRejected = true;
}
assert(wrongPasswordRejected, 'M12: invalid passwords must not create sessions.');

const session = await firstValueFrom(authService.login$(credentials));
assert(
  session.sessionToken.length >= 40,
  'M12: opaque session tokens should carry at least 256 bits of random input.',
);
const sessionHash = await hashOpaqueToken(session.sessionToken);
assert(
  sessionHash !== session.sessionToken,
  'M12: the server repository identity must be a hash rather than the bearer token.',
);
assert(
  await firstValueFrom(authRepository.findSessionByTokenHash$(sessionHash)),
  'M12: a successful login should persist the hashed session identity.',
);

const appAuthRepository = createMemoryAuthRepository();
const app = createApp({
  todosRepository: createMemoryTodoRepository(),
  authRepository: appAuthRepository,
  passwordHasher: testHasher,
});

const accountBeforeLogin = await app.request('/account/profile');
assertEqual(accountBeforeLogin.status, 302, 'M12: protected routes should redirect anonymous requests.');
assertEqual(accountBeforeLogin.headers.get('location'), '/login', 'M12: anonymous account requests should redirect to login.');

const registerResponse = await app.request('/auth/register', {
  method: 'POST',
  headers: {
    'content-type': 'application/x-www-form-urlencoded',
    origin: 'http://localhost',
  },
  body: new URLSearchParams(credentials),
});
assertEqual(registerResponse.status, 303, 'M12: registration should use POST/redirect/GET.');

const duplicateRegisterResponse = await app.request('/auth/register', {
  method: 'POST',
  headers: {
    'content-type': 'application/x-www-form-urlencoded',
    origin: 'http://localhost',
  },
  body: new URLSearchParams(credentials),
});
assertEqual(duplicateRegisterResponse.status, 303, 'M12: duplicate registration should stay on the normal redirect path.');
assertEqual(
  duplicateRegisterResponse.headers.get('location'),
  '/register?error=exists',
  'M12: duplicate registration should return the stable already-registered UI state.',
);

const crossSiteLogin = await app.request('/auth/login', {
  method: 'POST',
  headers: {
    'content-type': 'application/x-www-form-urlencoded',
    origin: 'https://attacker.example',
    'sec-fetch-site': 'cross-site',
  },
  body: new URLSearchParams(credentials),
});
assertEqual(crossSiteLogin.status, 403, 'M12: explicit cross-site login requests should be rejected.');

const loginResponse = await app.request('/auth/login', {
  method: 'POST',
  headers: {
    'content-type': 'application/x-www-form-urlencoded',
    origin: 'http://localhost',
  },
  body: new URLSearchParams(credentials),
});
assertEqual(loginResponse.status, 303, 'M12: successful login should redirect to the protected account page.');
assertEqual(loginResponse.headers.get('location'), '/account/profile', 'M12: login should redirect to /account/profile.');

const getSetCookie = (headers: Headers): readonly string[] => {
  const extended = headers as Headers & { getSetCookie?: () => string[] };
  if (extended.getSetCookie) {
    return extended.getSetCookie();
  }
  const combined = headers.get('set-cookie');
  return combined ? combined.split(/,(?=[^;,]+=)/u) : [];
};

const loginCookies = getSetCookie(loginResponse.headers);
const sessionCookie = loginCookies.find((cookie) => cookie.startsWith('id='));
const csrfCookie = loginCookies.find((cookie) => cookie.startsWith('csrf='));
assert(sessionCookie, 'M12: login should set the opaque session cookie.');
assert(csrfCookie, 'M12: login should set the CSRF companion cookie.');
assert(
  sessionCookie.includes('HttpOnly') && sessionCookie.includes('SameSite=Strict'),
  'M12: session cookie must be HttpOnly and SameSite=Strict.',
);
assert(
  !csrfCookie.includes('HttpOnly') && csrfCookie.includes('SameSite=Strict'),
  'M12: CSRF cookie should remain readable to forms while using SameSite=Strict.',
);

const cookiePair = (cookie: string): string => cookie.split(';', 1)[0] ?? '';
const cookieHeader = `${cookiePair(sessionCookie)}; ${cookiePair(csrfCookie)}`;
const csrfToken = cookiePair(csrfCookie).slice('csrf='.length);

const sessionResponse = await app.request('/auth/session', {
  headers: { cookie: cookieHeader },
});
assertEqual(sessionResponse.status, 200, 'M12: session introspection should return HTTP 200.');
const sessionJson = (await sessionResponse.json()) as {
  readonly user: { readonly email: string } | null;
};
assertEqual(sessionJson.user?.email, credentials.email, 'M12: session cookie should resolve to the authenticated user.');

const accountAfterLogin = await app.request('/account/profile', {
  headers: { cookie: cookieHeader },
});
assertEqual(accountAfterLogin.status, 200, 'M12: authenticated users should enter the protected account route.');
const accountHtml = await accountAfterLogin.text();
assert(accountHtml.includes(credentials.email), 'M12: protected SSR should receive the authenticated user through route context.');
assert(accountHtml.includes(`value="${csrfToken}"`), 'M12: protected SSR should render the session-bound CSRF token into the logout form.');

const badLogout = await app.request('/auth/logout', {
  method: 'POST',
  headers: {
    'content-type': 'application/x-www-form-urlencoded',
    origin: 'http://localhost',
    cookie: cookieHeader,
  },
  body: new URLSearchParams({ csrf: 'wrong-csrf-token' }),
});
assertEqual(badLogout.status, 403, 'M12: logout must reject a mismatched CSRF token.');

const logoutResponse = await app.request('/auth/logout', {
  method: 'POST',
  headers: {
    'content-type': 'application/x-www-form-urlencoded',
    origin: 'http://localhost',
    cookie: cookieHeader,
  },
  body: new URLSearchParams({ csrf: csrfToken }),
});
assertEqual(logoutResponse.status, 303, 'M12: valid logout should revoke the server session and redirect.');

const accountAfterLogout = await app.request('/account/profile', {
  headers: { cookie: cookieHeader },
});
assertEqual(accountAfterLogout.status, 302, 'M12: a revoked session must no longer authorize the protected route.');

const secureLogin = await app.request('https://rxjs-fullstack.test/auth/login', {
  method: 'POST',
  headers: {
    'content-type': 'application/x-www-form-urlencoded',
    origin: 'https://rxjs-fullstack.test',
  },
  body: new URLSearchParams(credentials),
});
assert(
  getSetCookie(secureLogin.headers).every((cookie) => cookie.includes('Secure')),
  'M12: HTTPS authentication responses should mark auth cookies Secure.',
);

const tempRoot = await mkdtemp(join(tmpdir(), 'rxjs-fullstack-m12-'));
try {
  const firstRepositories = await createPgliteApplicationRepositories({
    dataDir: join(tempRoot, 'postgres'),
  });
  const firstService = createAuthService({
    repository: firstRepositories.authRepository,
    passwordHasher: testHasher,
  });
  await firstValueFrom(firstService.register$(credentials));
  assertEqual(
    await firstValueFrom(
      firstRepositories.authRepository.createUser$(
        credentials.email,
        'duplicate-password-hash',
      ),
    ),
    undefined,
    'M12: Postgres email conflicts should be represented by the repository contract instead of an untyped uniqueness exception.',
  );
  const persistedSession = await firstValueFrom(firstService.login$(credentials));
  await firstRepositories.close();

  const reopenedRepositories = await createPgliteApplicationRepositories({
    dataDir: join(tempRoot, 'postgres'),
  });
  const reopenedService = createAuthService({
    repository: reopenedRepositories.authRepository,
    passwordHasher: testHasher,
  });
  const reopenedSession = await firstValueFrom(
    reopenedService.resolveSession$(
      persistedSession.sessionToken,
      persistedSession.csrfToken,
    ),
  );
  assertEqual(
    reopenedSession?.user.email,
    credentials.email,
    'M12: users and sessions should survive closing and reopening the Postgres database.',
  );
  await reopenedRepositories.close();
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

console.log('M12 authentication verification passed.');
