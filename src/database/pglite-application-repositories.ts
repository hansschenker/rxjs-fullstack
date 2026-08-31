import type { AuthRepository } from './auth-repository';
import {
  DEFAULT_DATABASE_PATH,
  openPgliteDatabase,
  type OpenPgliteDatabaseOptions,
} from './pglite-database';
import { createPgliteAuthRepositoryForDatabase } from './pglite-auth-repository';
import { createPgliteTodoRepositoryForDatabase } from './pglite-todos-repository';
import type { TodoRepository } from './todos-repository';

export { DEFAULT_DATABASE_PATH } from './pglite-database';

export interface PgliteApplicationRepositories {
  readonly todosRepository: TodoRepository;
  readonly authRepository: AuthRepository;
  readonly close: () => Promise<void>;
}

export const createPgliteApplicationRepositories = async (
  options: OpenPgliteDatabaseOptions = {},
): Promise<PgliteApplicationRepositories> => {
  const opened = await openPgliteDatabase(options);
  return {
    todosRepository: createPgliteTodoRepositoryForDatabase(opened.database, opened.close),
    authRepository: createPgliteAuthRepositoryForDatabase(opened.database, opened.close),
    close: opened.close,
  };
};

void DEFAULT_DATABASE_PATH;
