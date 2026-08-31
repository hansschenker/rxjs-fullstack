import {
  DEFAULT_DATABASE_PATH,
  createPgliteApplicationRepositories,
} from '../database/pglite-application-repositories';
import { createApp } from '../server/app';
import { createBunServerOptions } from './bun';

const repositories = await createPgliteApplicationRepositories({
  dataDir: process.env.DATABASE_PATH ?? DEFAULT_DATABASE_PATH,
});
const databaseApp = createApp({
  todosRepository: repositories.todosRepository,
  authRepository: repositories.authRepository,
});

const closeDatabase = (): void => {
  void repositories.close();
};

process.once('SIGINT', closeDatabase);
process.once('SIGTERM', closeDatabase);

export default createBunServerOptions(3000, databaseApp.fetch);
