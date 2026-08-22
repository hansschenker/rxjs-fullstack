import { defer, of } from 'rxjs';

import type { AuthUser } from '../auth/types';
import type {
  AuthRepository,
  CreateStoredAuthSession,
  StoredAuthSession,
  StoredAuthUser,
} from './auth-repository';
import type { RepositoryOperationOptions } from './repository';
import { throwIfRepositoryOperationAborted } from './repository';

export const createMemoryAuthRepository = (): AuthRepository => {
  const users: StoredAuthUser[] = [];
  const sessions = new Map<string, StoredAuthSession>();
  let nextUserId = 1;

  return {
    findUserByEmail$: (email, options?: RepositoryOperationOptions) =>
      defer(() => {
        throwIfRepositoryOperationAborted(options?.signal);
        const user = users.find((candidate) => candidate.email === email);
        return of(user ? { ...user } : undefined);
      }),
    createUser$: (
      email: string,
      passwordHash: string,
      options?: RepositoryOperationOptions,
    ) =>
      defer(() => {
        throwIfRepositoryOperationAborted(options?.signal);
        if (users.some((candidate) => candidate.email === email)) {
          return of(undefined);
        }
        const user: StoredAuthUser = {
          id: nextUserId++,
          email,
          passwordHash,
        };
        users.push(user);
        const publicUser: AuthUser = { id: user.id, email: user.email };
        return of(publicUser);
      }),
    createSession$: (
      session: CreateStoredAuthSession,
      options?: RepositoryOperationOptions,
    ) =>
      defer(() => {
        throwIfRepositoryOperationAborted(options?.signal);
        const user = users.find((candidate) => candidate.id === session.userId);
        if (!user) {
          throw new Error('Cannot create a session for an unknown user.');
        }
        sessions.set(session.tokenHash, {
          user: { id: user.id, email: user.email },
          csrfHash: session.csrfHash,
          expiresAt: new Date(session.expiresAt),
        });
        return of(undefined);
      }),
    findSessionByTokenHash$: (tokenHash, options?: RepositoryOperationOptions) =>
      defer(() => {
        throwIfRepositoryOperationAborted(options?.signal);
        const session = sessions.get(tokenHash);
        return of(
          session
            ? {
                user: { ...session.user },
                csrfHash: session.csrfHash,
                expiresAt: new Date(session.expiresAt),
              }
            : undefined,
        );
      }),
    deleteSessionByTokenHash$: (
      tokenHash,
      options?: RepositoryOperationOptions,
    ) =>
      defer(() => {
        throwIfRepositoryOperationAborted(options?.signal);
        sessions.delete(tokenHash);
        return of(undefined);
      }),
    close: async () => undefined,
  };
};
