import { fetchHandler } from './fetch';

export const DEFAULT_BUN_PORT = 3000;

export const createBunServerOptions = (port = DEFAULT_BUN_PORT) => ({
  port,
  fetch: fetchHandler,
});

export default createBunServerOptions();
