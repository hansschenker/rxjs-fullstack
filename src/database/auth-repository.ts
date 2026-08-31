import type { Observable } from 'rxjs';

import type { AuthUser } from '../auth/types';
import type { RepositoryOperationOptions } from './repository';

export interface StoredAuthUser extends AuthUser {
  readonly passwordHash: string;
}

export interface StoredAuthSession {
  readonly user: AuthUser;
  readonly csrfHash: string;
  readonly expiresAt: Date;
}

export interface CreateStoredAuthSession {
  readonly userId: number;
  readonly tokenHash: string;
  readonly csrfHash: string;
  readonly expiresAt: Date;
}

export interface AuthRepository {
  findUserByEmail$(
    email: string,
    options?: RepositoryOperationOptions,
  ): Observable<StoredAuthUser | undefined>;
  createUser$(
    email: string,
    passwordHash: string,
    options?: RepositoryOperationOptions,
  ): Observable<AuthUser | undefined>;
  createSession$(
    session: CreateStoredAuthSession,
    options?: RepositoryOperationOptions,
  ): Observable<void>;
  findSessionByTokenHash$(
    tokenHash: string,
    options?: RepositoryOperationOptions,
  ): Observable<StoredAuthSession | undefined>;
  deleteSessionByTokenHash$(
    tokenHash: string,
    options?: RepositoryOperationOptions,
  ): Observable<void>;
  close(): Promise<void>;
}
