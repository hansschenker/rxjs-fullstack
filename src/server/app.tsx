import { Hono } from 'hono';
import { stream } from 'hono/streaming';

import { createPbkdf2PasswordHasher, type PasswordHasher } from '../auth/password';
import { createAuthService } from '../auth/service';
import type { AuthRepository } from '../database/auth-repository';
import { createMemoryAuthRepository } from '../database/memory-auth-repository';
import { createMemoryTodoRepository } from '../database/memory-todos-repository';
import type { TodoRepository } from '../database/todos-repository';
import { renderRouteResponse } from '../render/page';
import { writeDocumentStream } from '../render/stream';
import { routes } from '../routes';
import { createApi } from './api';
import { createAuthHttp, resolveRequestAuth } from './auth';

export interface CreateAppOptions {
  readonly todosRepository?: TodoRepository;
  readonly authRepository?: AuthRepository;
  readonly passwordHasher?: PasswordHasher;
}

export const createApp = ({
  todosRepository = createMemoryTodoRepository(),
  authRepository = createMemoryAuthRepository(),
  passwordHasher = createPbkdf2PasswordHasher(),
}: CreateAppOptions = {}) => {
  const app = new Hono();
  const authService = createAuthService({
    repository: authRepository,
    passwordHasher,
  });

  app.get('/health', (context) => context.json({ ok: true }));
  app.route('/api', createApi({ todosRepository }));
  app.route('/auth', createAuthHttp({ authService }));

  app.use('/login', async (context, next) => {
    await next();
    context.header('cache-control', 'no-store');
  });
  app.use('/register', async (context, next) => {
    await next();
    context.header('cache-control', 'no-store');
  });
  app.use('/account/*', async (context, next) => {
    await next();
    context.header('cache-control', 'no-store');
  });

  app.get('*', async (context) => {
    const auth = await resolveRequestAuth(context, authService);
    const result = await renderRouteResponse({
      routes,
      request: context.req.raw,
      auth,
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

    if (result.type === 'stream') {
      context.header('cache-control', 'no-store');
      context.header('content-encoding', 'Identity');
      context.header('content-type', 'text/html; charset=UTF-8');

      return stream(context, async (streamingApi) => {
        await writeDocumentStream({
          sink: streamingApi,
          title: result.title,
          initialBody: result.initialBody,
          body$: result.body$,
          jsonScripts: result.jsonScripts,
        });
      });
    }

    return context.html(result.html);
  });

  return app;
};

export const app = createApp();
export default app;
