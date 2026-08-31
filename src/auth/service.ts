import { defer, firstValueFrom, type Observable } from 'rxjs';

import type { AuthRepository } from '../database/auth-repository';
import type { RepositoryOperationOptions } from '../database/repository';
import {
  constantTimeEqualString,
  createOpaqueToken,
  hashOpaqueToken,
  type PasswordHasher,
} from './password';
import type { AuthCredentials, AuthUser, CreatedAuthSession, ResolvedAuthSession } from './types';

export const AUTH_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

export class AuthInvalidCredentialsError extends Error {
  constructor() {
    super('Invalid authentication credentials.');
    this.name = 'AuthInvalidCredentialsError';
  }
}

export class AuthEmailAlreadyRegisteredError extends Error {
  constructor() {
    super('Email address is already registered.');
    this.name = 'AuthEmailAlreadyRegisteredError';
  }
}

export class AuthCsrfError extends Error {
  constructor() {
    super('Invalid CSRF token.');
    this.name = 'AuthCsrfError';
  }
}

export interface AuthService {
  register$(
    credentials: AuthCredentials,
    options?: RepositoryOperationOptions,
  ): Observable<AuthUser>;
  login$(
    credentials: AuthCredentials,
    options?: RepositoryOperationOptions,
  ): Observable<CreatedAuthSession>;
  resolveSession$(
    sessionToken: string | undefined,
    csrfToken: string | undefined,
    options?: RepositoryOperationOptions,
  ): Observable<ResolvedAuthSession | null>;
  logout$(
    sessionToken: string | undefined,
    csrfToken: string | undefined,
    options?: RepositoryOperationOptions,
  ): Observable<void>;
}

export interface CreateAuthServiceOptions {
  readonly repository: AuthRepository;
  readonly passwordHasher: PasswordHasher;
  readonly now?: () => number;
}

export const createAuthService = ({
  repository,
  passwordHasher,
  now = Date.now,
}: CreateAuthServiceOptions): AuthService => {
  const resolveSession = async (
    sessionToken: string | undefined,
    csrfToken: string | undefined,
    options?: RepositoryOperationOptions,
  ): Promise<ResolvedAuthSession | null> => {
    if (!sessionToken) {
      return null;
    }

    const sessionTokenHash = await hashOpaqueToken(sessionToken);
    const stored = await firstValueFrom(
      repository.findSessionByTokenHash$(sessionTokenHash, options),
    );
    if (!stored) {
      return null;
    }

    if (stored.expiresAt.getTime() <= now()) {
      await firstValueFrom(repository.deleteSessionByTokenHash$(sessionTokenHash, options));
      return null;
    }

    const csrfHash = csrfToken ? await hashOpaqueToken(csrfToken) : undefined;
    const csrfValid = csrfHash !== undefined && constantTimeEqualString(csrfHash, stored.csrfHash);

    return {
      user: stored.user,
      sessionTokenHash,
      csrfValid,
      ...(csrfValid && csrfToken ? { csrfToken } : {}),
    };
  };

  return {
    register$: (credentials, options) =>
      defer(async () => {
        const existing = await firstValueFrom(
          repository.findUserByEmail$(credentials.email, options),
        );
        if (existing) {
          throw new AuthEmailAlreadyRegisteredError();
        }

        const passwordHash = await passwordHasher.hash(credentials.password);
        const created = await firstValueFrom(
          repository.createUser$(credentials.email, passwordHash, options),
        );
        if (!created) {
          throw new AuthEmailAlreadyRegisteredError();
        }
        return created;
      }),
    login$: (credentials, options) =>
      defer(async () => {
        const user = await firstValueFrom(repository.findUserByEmail$(credentials.email, options));

        let passwordMatches = false;
        if (user) {
          passwordMatches = await passwordHasher.verify(credentials.password, user.passwordHash);
        } else {
          // Perform one password derivation for unknown identities as well so
          // the invalid-login path does not expose a large password-KDF timing gap.
          await passwordHasher.hash(credentials.password);
        }

        if (!user || !passwordMatches) {
          throw new AuthInvalidCredentialsError();
        }

        const sessionToken = createOpaqueToken();
        const csrfToken = createOpaqueToken();
        const [tokenHash, csrfHash] = await Promise.all([
          hashOpaqueToken(sessionToken),
          hashOpaqueToken(csrfToken),
        ]);
        const expiresAt = new Date(now() + AUTH_SESSION_TTL_MS);

        await firstValueFrom(
          repository.createSession$({ userId: user.id, tokenHash, csrfHash, expiresAt }, options),
        );

        return {
          user: { id: user.id, email: user.email },
          sessionToken,
          csrfToken,
          expiresAt,
        };
      }),
    resolveSession$: (sessionToken, csrfToken, options) =>
      defer(() => resolveSession(sessionToken, csrfToken, options)),
    logout$: (sessionToken, csrfToken, options) =>
      defer(async () => {
        const resolved = await resolveSession(sessionToken, csrfToken, options);
        if (!resolved || !resolved.csrfValid) {
          throw new AuthCsrfError();
        }

        await firstValueFrom(
          repository.deleteSessionByTokenHash$(resolved.sessionTokenHash, options),
        );
      }),
  };
};
