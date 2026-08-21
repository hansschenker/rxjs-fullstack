import { Hono } from 'hono';
import { resolveRequest } from 'rxjs-router';

import { renderDocument, renderToString } from '../render/html';
import { routes, type PageData } from '../routes';
import { api } from './api';

export const app = new Hono();

app.get('/health', (context) => context.json({ ok: true }));

app.route('/api', api);

app.get('*', async (context) => {
  const result = await resolveRequest({
    routes,
    request: context.req.raw,
  });

  if (result.type === 'redirect') {
    return context.redirect(result.location, result.statusCode as 301 | 302 | 303 | 307 | 308);
  }

  if (result.type === 'notFound') {
    return context.text('Not found', 404);
  }

  if (result.type === 'error') {
    return context.text('Internal Server Error', 500);
  }

  const page = result.match.data as PageData;
  const body = renderToString(page.view);
  const html = renderDocument({ title: page.title, body });

  return context.html(html);
});

export default app;
