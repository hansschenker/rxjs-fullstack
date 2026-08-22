import { fetchHandler } from './fetch';

export const DEFAULT_BUN_PORT = 3000;

export const createBunServerOptions = (port = DEFAULT_BUN_PORT, fetch = fetchHandler) => ({
  port,
  fetch,
});

export default createBunServerOptions();
