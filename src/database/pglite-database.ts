import { PGlite } from '@electric-sql/pglite';

import { databaseMigrations } from './migrations';
import { seedTodos } from './todos-seed';

export const DEFAULT_DATABASE_PATH = './.rxjs-fullstack-db';

export interface OpenPgliteDatabaseOptions {
  readonly dataDir?: string;
  readonly seed?: boolean;
}

interface CountRow {
  readonly count: number;
}

interface MigrationRow {
  readonly version: number;
}

export const preservePgliteProcessExitCode = async <T>(operation: () => Promise<T>): Promise<T> => {
  const previousExitCode = process.exitCode;
  try {
    return await operation();
  } finally {
    process.exitCode = previousExitCode ?? 0;
  }
};

const applyMigrations = async (database: PGlite): Promise<void> => {
  await database.exec(`
    CREATE TABLE IF NOT EXISTS rxjs_fullstack_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const applied = await database.query<MigrationRow>(
    'SELECT version FROM rxjs_fullstack_migrations ORDER BY version',
  );
  const appliedVersions = new Set(applied.rows.map((row) => row.version));

  for (const migration of databaseMigrations) {
    if (appliedVersions.has(migration.version)) {
      continue;
    }

    await database.transaction(async (transaction) => {
      await transaction.exec(migration.sql);
      await transaction.query(
        'INSERT INTO rxjs_fullstack_migrations (version, name) VALUES ($1, $2)',
        [migration.version, migration.name],
      );
    });
  }
};

const seedDatabase = async (database: PGlite): Promise<void> => {
  const result = await database.query<CountRow>('SELECT COUNT(*)::int AS count FROM todos');
  const count = result.rows[0]?.count ?? 0;
  if (count > 0) {
    return;
  }

  await database.transaction(async (transaction) => {
    for (const todo of seedTodos) {
      await transaction.query('INSERT INTO todos (title, done) VALUES ($1, $2)', [
        todo.title,
        todo.done,
      ]);
    }
  });
};

export interface OpenedPgliteDatabase {
  readonly database: PGlite;
  readonly close: () => Promise<void>;
}

export const openPgliteDatabase = async ({
  dataDir = 'memory://',
  seed = true,
}: OpenPgliteDatabaseOptions = {}): Promise<OpenedPgliteDatabase> => {
  const database = await preservePgliteProcessExitCode(() => PGlite.create(dataDir));
  await applyMigrations(database);
  if (seed) {
    await seedDatabase(database);
  }

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) {
      return;
    }
    closed = true;
    await preservePgliteProcessExitCode(() => database.close());
  };

  return { database, close };
};
