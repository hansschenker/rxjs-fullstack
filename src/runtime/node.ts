import {
  DEFAULT_DATABASE_PATH,
  createPgliteTodoRepository,
} from '../database/pglite-todos-repository';
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
export const todosRepository = await createPgliteTodoRepository({
  dataDir: process.env.DATABASE_PATH ?? DEFAULT_DATABASE_PATH,
});
const databaseApp = createApp({ todosRepository });
export const nodeServer = createNodeServer({
  port: nodePort,
  fetch: databaseApp.fetch,
});

console.log(`RxJS Fullstack listening on http://localhost:${nodePort} (Node.js)`);

const shutdown = (): void => {
  nodeServer.close(() => {
    void todosRepository.close();
  });
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
