import { Hono } from 'hono';
import { resolveRequest } from 'rxjs-router';

import {
  QUERY_STATE_SCRIPT_ID,
  QueryClient,
  dehydrate,
} from '../query';
import { renderDocument, renderToString } from '../render/html';
import { routes, type PageData } from '../routes';
import { api } from './api';
import type { ServerRouteContext } from './route-context';

export const app = new Hono();

app.get('/health', (context) => context.json({ ok: true }));

app.route('/api', api);

app.get('*', async (context) => {
  const queryClient = new QueryClient();
  const routeContext: ServerRouteContext = {
    queryClient,
    fetch: async (input, init) => {
      const url = new URL(input, context.req.raw.url);
      return app.request(`${url.pathname}${url.search}`, init);
    },
  };

  const result = await resolveRequest({
    routes,
    request: context.req.raw,
    context: routeContext,
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
  const html = renderDocument({
    title: page.title,
    body,
    jsonScripts: [
      {
        id: QUERY_STATE_SCRIPT_ID,
        value: dehydrate(queryClient),
      },
    ],
  });

  return context.html(html);
});

export default app;
