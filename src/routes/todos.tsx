import { filter, firstValueFrom, fromEvent, map, take, takeUntil } from 'rxjs';
import { createChildRoute } from 'rxjs-router';

import { TodoApp, TodoSnapshot } from '../examples/todos';
import { Fragment, jsx } from '../jsx/runtime';
import { createTodosQuery, type Todo } from '../queries/todos';
import type { ServerRouteContext } from '../server/route-context';
import { rootBaseRoute } from './root';
import type { PageData } from './types';

const isServerRouteContext = (value: unknown): value is ServerRouteContext =>
  typeof value === 'object' &&
  value !== null &&
  'queryClient' in value &&
  'fetch' in value;

const loadTodosForSsr = async (
  context: ServerRouteContext,
  signal: AbortSignal,
): Promise<readonly Todo[]> => {
  if (signal.aborted) {
    throw signal.reason ?? new Error('Route request aborted.');
  }

  return firstValueFrom(
    context.queryClient.query$(createTodosQuery(context.fetch)).pipe(
      takeUntil(fromEvent(signal, 'abort')),
      filter((result) => result.data !== undefined || result.isError),
      take(1),
      map((result) => {
        if (result.isError) {
          throw result.error;
        }
        return result.data ?? [];
      }),
    ),
  );
};

export const todosRoute = createChildRoute<typeof rootBaseRoute>()({
  id: 'todos',
  path: 'todos',
  loader: async ({ parentData, context, signal }): Promise<PageData> => {
    const serverContext = isServerRouteContext(context) ? context : undefined;
    const todos = serverContext
      ? await loadTodosForSsr(serverContext, signal)
      : undefined;

    return {
      title: `${parentData.appName} Todos`,
      view: (
        <main>
          <h1>{parentData.appName} Todos</h1>
          <p>
            Queries use Query/Cache; form mutations use RxJS server actions.
          </p>
          <div id="app">
            {todos ? <TodoSnapshot todos={todos} /> : <TodoApp />}
          </div>
        </main>
      ),
    };
  },
});

export default todosRoute;
