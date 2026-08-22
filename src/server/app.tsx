import { Hono } from 'hono';

import { renderRouteDocument } from '../render/page';
import { routes } from '../routes';
import { api } from './api';

export const app = new Hono();

app.get('/health', (context) => context.json({ ok: true }));

app.route('/api', api);

app.get('*', async (context) => {
  const result = await renderRouteDocument({
    routes,
    request: context.req.raw,
    fetch: async (input, init) => {
      const url = new URL(input, context.req.raw.url);
      return app.request(`${url.pathname}${url.search}`, init);
    },
  });

  if (result.type === 'redirect') {
    return context.redirect(
      result.location,
      result.statusCode as 301 | 302 | 303 | 307 | 308,
    );
  }

  if (result.type === 'notFound') {
    return context.text('Not found', 404);
  }

  if (result.type === 'error') {
    return context.text('Internal Server Error', 500);
  }

  return context.html(result.html);
});

export default app;
