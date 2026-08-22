import {
  DEFAULT_DATABASE_PATH,
  createPgliteTodoRepository,
} from '../database/pglite-todos-repository';
import { createApp } from '../server/app';
import { createBunServerOptions } from './bun';

const todosRepository = await createPgliteTodoRepository({
  dataDir: process.env.DATABASE_PATH ?? DEFAULT_DATABASE_PATH,
});
const databaseApp = createApp({ todosRepository });

const closeDatabase = (): void => {
  void todosRepository.close();
};

process.once('SIGINT', closeDatabase);
process.once('SIGTERM', closeDatabase);

export default createBunServerOptions(3000, databaseApp.fetch);
