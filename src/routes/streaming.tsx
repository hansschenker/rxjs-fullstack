import { concat, concatMap, filter, fromEvent, map, of, take, takeUntil, timer } from 'rxjs';
import { createChildRoute } from 'rxjs-router';

import { TodoSnapshot } from '../examples/todos';
import { createTodosQuery, type Todo } from '../queries/todos';
import type { ServerRouteContext } from '../server/route-context';
import { rootBaseRoute } from './root';
import type { PageData } from './types';

const isServerRouteContext = (value: unknown): value is ServerRouteContext =>
  typeof value === 'object' && value !== null && 'queryClient' in value && 'fetch' in value;

const aborted$ = (signal: AbortSignal) =>
  signal.aborted ? of(signal.reason) : fromEvent(signal, 'abort');

const streamedTodos$ = (context: ServerRouteContext) =>
  timer(15).pipe(
    concatMap(() =>
      context.queryClient.query$(createTodosQuery(context.fetch)).pipe(
        filter((result) => result.data !== undefined || result.isError),
        take(1),
        map((result): readonly Todo[] => {
          if (result.isError) {
            throw result.error;
          }
          return result.data ?? [];
        }),
      ),
    ),
    map((todos) => (
      <section id="streaming-todos">
        <h2>Query/Cache result</h2>
        <p>This chunk arrives after the request-scoped Todos query resolves.</p>
        <TodoSnapshot todos={todos} />
      </section>
    )),
  );

export const streamingRoute = createChildRoute<typeof rootBaseRoute>()({
  id: 'streaming',
  path: 'streaming',
  loader: ({ parentData, context, signal }): PageData => {
    const serverContext = isServerRouteContext(context) ? context : undefined;

    if (!serverContext) {
      return {
        title: `${parentData.appName} Streaming SSR`,
        view: (
          <main>
            <h1>{parentData.appName} Streaming SSR</h1>
            <p>This example is resolved by the server streaming boundary.</p>
          </main>
        ),
      };
    }

    if (signal.aborted) {
      throw signal.reason ?? new Error('Streaming route request aborted.');
    }

    const stream$ = concat(
      timer(5).pipe(
        map(() => (
          <section id="streaming-progress">
            <h2>RxJS server chunk</h2>
            <p>The response is open while later server work is still pending.</p>
          </section>
        )),
      ),
      streamedTodos$(serverContext),
    ).pipe(takeUntil(aborted$(signal)));

    return {
      title: `${parentData.appName} Streaming SSR`,
      view: (
        <header id="streaming-shell">
          <h1>{parentData.appName} Streaming SSR</h1>
          <p>The document shell is emitted before the streamed RxJS chunks.</p>
        </header>
      ),
      stream$,
    };
  },
});

export default streamingRoute;
