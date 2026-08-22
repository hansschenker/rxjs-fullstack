import { Hono } from 'hono';

import { createMemoryTodoRepository } from '../database/memory-todos-repository';
import type { TodoRepository } from '../database/todos-repository';
import { renderRouteDocument } from '../render/page';
import { routes } from '../routes';
import { createApi } from './api';

export interface CreateAppOptions {
  readonly todosRepository?: TodoRepository;
}

export const createApp = ({
  todosRepository = createMemoryTodoRepository(),
}: CreateAppOptions = {}) => {
  const app = new Hono();

  app.get('/health', (context) => context.json({ ok: true }));
  app.route('/api', createApi({ todosRepository }));

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

  return app;
};

export const app = createApp();
export default app;
