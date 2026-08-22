import {
  DEFAULT_DATABASE_PATH,
  createPgliteApplicationRepositories,
} from '../database/pglite-application-repositories';
import { createApp } from '../server/app';
import { createNodeServer, DEFAULT_NODE_PORT } from './node-adapter';

const parsePort = (value: string | undefined): number => {
  if (!value) {
    return DEFAULT_NODE_PORT;
  }

  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65_535
    ? port
    : DEFAULT_NODE_PORT;
};

export const nodePort = parsePort(process.env.PORT);
export const repositories = await createPgliteApplicationRepositories({
  dataDir: process.env.DATABASE_PATH ?? DEFAULT_DATABASE_PATH,
});
const databaseApp = createApp({
  todosRepository: repositories.todosRepository,
  authRepository: repositories.authRepository,
});
export const nodeServer = createNodeServer({
  port: nodePort,
  fetch: databaseApp.fetch,
});

console.log(`RxJS Fullstack listening on http://localhost:${nodePort} (Node.js)`);

const shutdown = (): void => {
  nodeServer.close(() => {
    void repositories.close();
  });
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
