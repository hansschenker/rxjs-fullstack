import { fetchHandler } from './fetch';

// Cloudflare Workers Module Worker shape. No Cloudflare-specific application
// API is required because Hono already exposes the standard fetch boundary.
export const cloudflareWorker = {
  fetch: fetchHandler,
};

export default cloudflareWorker;
