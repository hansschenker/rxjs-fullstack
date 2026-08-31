import type { PGlite } from '@electric-sql/pglite';
import { defer } from 'rxjs';

import type { AuthUser } from '../auth/types';
import type {
  AuthRepository,
  CreateStoredAuthSession,
  StoredAuthSession,
  StoredAuthUser,
} from './auth-repository';
import type { RepositoryOperationOptions } from './repository';
import { throwIfRepositoryOperationAborted } from './repository';

interface UserRow {
  readonly id: number;
  readonly email: string;
  readonly password_hash: string;
}

interface SessionRow {
  readonly id: number;
  readonly email: string;
  readonly csrf_hash: string;
  readonly expires_at: Date | string;
}

const userFromRow = (row: UserRow): StoredAuthUser => ({
  id: row.id,
  email: row.email,
  passwordHash: row.password_hash,
});

export const createPgliteAuthRepositoryForDatabase = (
  database: PGlite,
  close: () => Promise<void> = async () => undefined,
): AuthRepository => ({
  findUserByEmail$: (email, options?: RepositoryOperationOptions) =>
    defer(async () => {
      throwIfRepositoryOperationAborted(options?.signal);
      const result = await database.query<UserRow>(
        'SELECT id, email, password_hash FROM auth_users WHERE email = $1',
        [email],
      );
      const row = result.rows[0];
      return row ? userFromRow(row) : undefined;
    }),
  createUser$: (email: string, passwordHash: string, options?: RepositoryOperationOptions) =>
    defer(async () => {
      throwIfRepositoryOperationAborted(options?.signal);
      const result = await database.query<UserRow>(
        `
          INSERT INTO auth_users (email, password_hash)
          VALUES ($1, $2)
          ON CONFLICT (email) DO NOTHING
          RETURNING id, email, password_hash
        `,
        [email, passwordHash],
      );
      const row = result.rows[0];
      if (!row) {
        return undefined;
      }
      const user: AuthUser = { id: row.id, email: row.email };
      return user;
    }),
  createSession$: (session: CreateStoredAuthSession, options?: RepositoryOperationOptions) =>
    defer(async () => {
      throwIfRepositoryOperationAborted(options?.signal);
      await database.query(
        `
          INSERT INTO auth_sessions (token_hash, user_id, csrf_hash, expires_at)
          VALUES ($1, $2, $3, $4)
        `,
        [session.tokenHash, session.userId, session.csrfHash, session.expiresAt.toISOString()],
      );
    }),
  findSessionByTokenHash$: (tokenHash, options?: RepositoryOperationOptions) =>
    defer(async () => {
      throwIfRepositoryOperationAborted(options?.signal);
      const result = await database.query<SessionRow>(
        `
          SELECT u.id, u.email, s.csrf_hash, s.expires_at
          FROM auth_sessions AS s
          JOIN auth_users AS u ON u.id = s.user_id
          WHERE s.token_hash = $1
        `,
        [tokenHash],
      );
      const row = result.rows[0];
      if (!row) {
        return undefined;
      }
      const session: StoredAuthSession = {
        user: { id: row.id, email: row.email },
        csrfHash: row.csrf_hash,
        expiresAt: new Date(row.expires_at),
      };
      return session;
    }),
  deleteSessionByTokenHash$: (tokenHash, options?: RepositoryOperationOptions) =>
    defer(async () => {
      throwIfRepositoryOperationAborted(options?.signal);
      await database.query('DELETE FROM auth_sessions WHERE token_hash = $1', [tokenHash]);
    }),
  close,
});
