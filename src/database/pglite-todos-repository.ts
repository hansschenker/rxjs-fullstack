import { PGlite } from '@electric-sql/pglite';
import { defer } from 'rxjs';

import type { CreateTodoInput, Todo } from '../domain/todos';
import { databaseMigrations } from './migrations';
import {
  type RepositoryOperationOptions,
  type TodoRepository,
  throwIfRepositoryOperationAborted,
} from './todos-repository';
import { seedTodos } from './todos-seed';

export const DEFAULT_DATABASE_PATH = './.rxjs-fullstack-db';

export interface PgliteTodoRepositoryOptions {
  readonly dataDir?: string;
  readonly seed?: boolean;
}

interface TodoRow {
  readonly id: number;
  readonly title: string;
  readonly done: boolean;
}

interface CountRow {
  readonly count: number;
}

interface MigrationRow {
  readonly version: number;
}

const todoFromRow = (row: TodoRow): Todo => ({
  id: row.id,
  title: row.title,
  done: row.done,
});

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
  const result = await database.query<CountRow>(
    'SELECT COUNT(*)::int AS count FROM todos',
  );
  const count = result.rows[0]?.count ?? 0;

  if (count > 0) {
    return;
  }

  await database.transaction(async (transaction) => {
    for (const todo of seedTodos) {
      await transaction.query(
        'INSERT INTO todos (title, done) VALUES ($1, $2)',
        [todo.title, todo.done],
      );
    }
  });
};

export const createPgliteTodoRepository = async ({
  dataDir = 'memory://',
  seed = true,
}: PgliteTodoRepositoryOptions = {}): Promise<TodoRepository> => {
  const database = await PGlite.create(dataDir);
  await applyMigrations(database);

  if (seed) {
    await seedDatabase(database);
  }

  return {
    list$: (options?: RepositoryOperationOptions) =>
      defer(async () => {
        throwIfRepositoryOperationAborted(options?.signal);
        const result = await database.query<TodoRow>(
          'SELECT id, title, done FROM todos ORDER BY id',
        );
        return result.rows.map(todoFromRow);
      }),
    create$: (
      { title }: CreateTodoInput,
      options?: RepositoryOperationOptions,
    ) =>
      defer(async () => {
        throwIfRepositoryOperationAborted(options?.signal);
        const result = await database.query<TodoRow>(
          `
            INSERT INTO todos (title, done)
            VALUES ($1, FALSE)
            RETURNING id, title, done
          `,
          [title],
        );
        const row = result.rows[0];
        if (!row) {
          throw new Error('Database insert did not return the created Todo.');
        }
        return todoFromRow(row);
      }),
    close: () => database.close(),
  };
};
