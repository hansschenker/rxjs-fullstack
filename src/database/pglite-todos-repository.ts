import type { PGlite } from '@electric-sql/pglite';
import { defer } from 'rxjs';

import type { CreateTodoInput, Todo } from '../domain/todos';
import {
  DEFAULT_DATABASE_PATH,
  openPgliteDatabase,
  type OpenPgliteDatabaseOptions,
} from './pglite-database';
import {
  type RepositoryOperationOptions,
  type TodoRepository,
  throwIfRepositoryOperationAborted,
} from './todos-repository';

export { DEFAULT_DATABASE_PATH } from './pglite-database';
export type PgliteTodoRepositoryOptions = OpenPgliteDatabaseOptions;

interface TodoRow {
  readonly id: number;
  readonly title: string;
  readonly done: boolean;
}

const todoFromRow = (row: TodoRow): Todo => ({
  id: row.id,
  title: row.title,
  done: row.done,
});

export const createPgliteTodoRepositoryForDatabase = (
  database: PGlite,
  close: () => Promise<void> = async () => undefined,
): TodoRepository => ({
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
  close,
});

export const createPgliteTodoRepository = async (
  options: PgliteTodoRepositoryOptions = {},
): Promise<TodoRepository> => {
  const opened = await openPgliteDatabase(options);
  return createPgliteTodoRepositoryForDatabase(opened.database, opened.close);
};

void DEFAULT_DATABASE_PATH;
