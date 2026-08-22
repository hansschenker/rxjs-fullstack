import { serve } from '@hono/node-server';

import { fetchHandler } from './fetch';

export const DEFAULT_NODE_PORT = 3000;

export interface NodeServerOptions {
  readonly port?: number;
}

export const createNodeServer = ({
  port = DEFAULT_NODE_PORT,
}: NodeServerOptions = {}) =>
  serve({
    fetch: fetchHandler,
    port,
  });
