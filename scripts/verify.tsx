import { defer, firstValueFrom, map, of } from 'rxjs';
import { createRoute } from 'rxjs-router';

import { helloRoute } from '../src/examples/routes';
import { Fragment, jsx } from '../src/jsx/runtime';
import {
  QUERY_STATE_SCRIPT_ID,
  QueryClient,
  dehydrate,
  hydrateQueryClientFromDocument,
  queryOptions,
} from '../src/query';
import { renderToString } from '../src/render/html';
import type { RouteParams } from '../src/router/route';
import { generatedRouteFiles, routes } from '../src/routes.generated';
import { executeServerAction$ } from '../src/server/action';
import { app } from '../src/server/app';
import {
  collectStaticPathnames,
  renderStaticPage,
  staticOutputPath,
} from '../src/ssg/static';

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const assertEqual = (actual: unknown, expected: unknown, message: string): void => {
  if (!Object.is(actual, expected)) {
    throw new Error(`${message}\nExpected: ${String(expected)}\nActual: ${String(actual)}`);
  }
};

const Greeting = ({ name }: { readonly name: string }) => <h1>Hello {name}</h1>;

assertEqual(
  renderToString(<Greeting name="RxJS <Fullstack>" />),
  '<h1>Hello RxJS &lt;Fullstack&gt;</h1>',
  'M01: JSX components should produce the framework view representation.',
);

let executions = 0;
const lazyHtml$ = defer(() => {
  executions += 1;
  return of(<p>lazy</p>);
}).pipe(map(renderToString));

assertEqual(executions, 0, 'M03: SSR Observable must remain lazy before subscription.');
assertEqual(await firstValueFrom(lazyHtml$), '<p>lazy</p>', 'M03: SSR pipeline should render HTML.');
assertEqual(executions, 1, 'M03: firstValueFrom should create exactly one subscription.');

let observableChildRejected = false;
try {
  renderToString(<p>{of('server value')}</p>);
} catch (error) {
  observableChildRejected =
    error instanceof TypeError && error.message.includes('Resolve server data');
}
assert(
  observableChildRejected,
  'M03: HTML renderer must require server Observables to be resolved explicitly before rendering.',
);

const response = await app.request('/');
assertEqual(response.status, 200, 'M04-M13: root route should return HTTP 200.');
const body = await response.text();
assert(body.includes('<h1>RxJS Fullstack</h1>'), 'M04: root route should return SSR HTML.');
assert(
  body.includes('M01-M13 vertical slice with streaming SSR'),
  'M13: SSR route should report the current milestone.',
);

const counterResponse = await app.request('/counter');
assertEqual(counterResponse.status, 200, 'M05-M13: counter route should return HTTP 200.');
const counterBody = await counterResponse.text();
assert(counterBody.includes('<h1>RxJS Fullstack Counter</h1>'), 'M05: router should render nested counter route.');

const aboutResponse = await app.request('/about');
assertEqual(aboutResponse.status, 200, 'M06: generated about route should return HTTP 200.');
const aboutBody = await aboutResponse.text();
assert(
  aboutBody.includes('<h1>About RxJS Fullstack</h1>'),
  'M06: a discovered route module should participate in SSR without manual route registration.',
);
assert(
  generatedRouteFiles.includes('about.tsx'),
  'M06: generated route manifest should contain newly discovered page modules.',
);

const loginResponse = await app.request('/login');
assertEqual(loginResponse.status, 200, 'M12: login route should be a public SSR page.');
const accountResponse = await app.request('/account/profile');
assertEqual(accountResponse.status, 302, 'M12: protected account route should redirect anonymous requests.');

const health = await app.request('/health');
assertEqual(health.status, 200, 'M04: health route should return HTTP 200.');
assertEqual(await health.text(), '{"ok":true}', 'M04: health route should return JSON.');

const typedParams: RouteParams<'/teams/:teamId/users/:userId'> = {
  teamId: 'rxjs',
  userId: '42',
};
assertEqual(typedParams.teamId, 'rxjs', 'M05: route path should infer teamId.');
assertEqual(typedParams.userId, '42', 'M05: route path should infer userId.');

assertEqual(
  helloRoute.href({ name: 'Erik Meijer' }),
  '/hello/Erik%20Meijer',
  'M05: route href should require and encode path-derived params.',
);

let hrefMissingParamRejected = false;
try {
  // @ts-expect-error M05: href requires the path-derived "name" parameter.
  helloRoute.href({});
} catch {
  hrefMissingParamRejected = true;
}
assert(hrefMissingParamRejected, 'M05: href should throw when a path param is missing.');

let hrefWrongParamRejected = false;
try {
  // @ts-expect-error M05: href rejects unrelated parameter names.
  helloRoute.href({ id: 'Erik' });
} catch {
  hrefWrongParamRejected = true;
}
assert(hrefWrongParamRejected, 'M05: href should throw for unrelated parameter names.');

const todosResponse = await app.request('/todos');
assertEqual(todosResponse.status, 200, 'M05-M13: todos route should return HTTP 200.');
const todosBody = await todosResponse.text();
assert(todosBody.includes('<h1>RxJS Fullstack Todos</h1>'), 'M05: todos route should render SSR HTML.');
assert(
  todosBody.includes('Port TanStack Query to RxJS'),
  'M08: Todos SSR should contain server-prefetched query data instead of a loading placeholder.',
);
assert(
  !todosBody.includes('Loading todos...'),
  'M08: Todos SSR should not cold-start from a loading placeholder.',
);
assert(
  todosBody.includes(`id="${QUERY_STATE_SCRIPT_ID}"`),
  'M08: SSR HTML should carry dehydrated Query/Cache state for the browser.',
);

const staticPathnames = collectStaticPathnames(routes);
assertEqual(
  JSON.stringify(staticPathnames),
  JSON.stringify(['/', '/about', '/counter', '/login', '/register', '/streaming', '/todos']),
  'M09-M13: static path discovery should include public auth/streaming pages and exclude the parameterized protected account route.',
);
assert(
  staticPathnames.includes('/streaming'),
  'M13: the concrete streaming route should remain eligible for buffered static generation.',
);
assert(
  !staticPathnames.includes('/account/$section'),
  'M12: protected parameterized account routes should remain outside automatic SSG.',
);
assertEqual(
  staticOutputPath('/'),
  'dist/static/index.html',
  'M09: root static output should map to dist/static/index.html.',
);
assertEqual(
  staticOutputPath('/todos'),
  'dist/static/todos/index.html',
  'M09: nested static output should map to a directory index file.',
);

const dynamicRoutes = [
  createRoute({
    path: '/',
    children: [createRoute({ path: 'posts/$slug' })],
  }),
] as const;
assert(
  !collectStaticPathnames(dynamicRoutes).includes('/posts/$slug'),
  'M09: parameterized routes should be excluded until build-time params are supplied explicitly.',
);

const fetchFromApp = async (input: string, init?: RequestInit): Promise<Response> => {
  const url = new URL(input, 'http://rxjs-fullstack.verify');
  return app.request(`${url.pathname}${url.search}`, init);
};

const staticAbout = await renderStaticPage({
  routes,
  pathname: '/about',
  fetch: fetchFromApp,
});
assertEqual(
  staticAbout.html,
  aboutBody,
  'M09: build-time /about rendering should be byte-for-byte equivalent to request-time SSR.',
);

const staticTodos = await renderStaticPage({
  routes,
  pathname: '/todos',
  fetch: fetchFromApp,
});
assert(
  staticTodos.html.includes('Port TanStack Query to RxJS'),
  'M09: build-time /todos rendering should reuse M08 Query/Cache prefetch.',
);
assert(
  staticTodos.html.includes(`id="${QUERY_STATE_SCRIPT_ID}"`),
  'M09: build-time /todos should preserve dehydrated Query/Cache state.',
);

const todosApi = await app.request('/api/todos');
assertEqual(todosApi.status, 200, 'M05: todos API should return HTTP 200.');
const todosJson = (await todosApi.json()) as ReadonlyArray<{ readonly id: number }>;
assert(Array.isArray(todosJson) && todosJson.length > 0, 'M05: todos API should return seeded todos.');

const serverQueryClient = new QueryClient();
let serverQueryExecutions = 0;
const serverContinuityQuery = queryOptions({
  queryKey: ['m08-continuity'] as const,
  staleTime: 60_000,
  queryFn: async () => {
    serverQueryExecutions += 1;
    return { value: 42 } as const;
  },
});
await firstValueFrom(serverQueryClient.fetchQuery(serverContinuityQuery));
assertEqual(serverQueryExecutions, 1, 'M08: server query should execute once before dehydration.');

const dehydratedState = dehydrate(serverQueryClient);
const browserQueryClient = new QueryClient();
const didHydrate = hydrateQueryClientFromDocument(browserQueryClient, {
  getElementById: (id) =>
    id === QUERY_STATE_SCRIPT_ID
      ? { textContent: JSON.stringify(dehydratedState) }
      : null,
});
assert(didHydrate, 'M08: browser bootstrap should restore serialized Query/Cache state.');

let browserQueryExecutions = 0;
const browserContinuityQuery = queryOptions({
  queryKey: ['m08-continuity'] as const,
  staleTime: 60_000,
  queryFn: async () => {
    browserQueryExecutions += 1;
    return { value: 99 } as const;
  },
});
const hydratedResult = await firstValueFrom(browserQueryClient.query$(browserContinuityQuery));
assertEqual(
  hydratedResult.data?.value,
  42,
  'M08: browser query should begin from the server-resolved cached value.',
);
assertEqual(
  browserQueryExecutions,
  0,
  'M08: a fresh hydrated query should not execute an unnecessary second cold fetch.',
);

let actionParses = 0;
let actionExecutions = 0;
const actionRequest = new Request('http://localhost/api/actions/test', { method: 'POST' });
const lazyAction$ = executeServerAction$(
  {
    parse: (value) => {
      actionParses += 1;
      return value as { readonly value: number };
    },
    run: ({ value }) =>
      defer(() => {
        actionExecutions += 1;
        return of(value * 2);
      }),
  },
  { value: 21 },
  { request: actionRequest, signal: actionRequest.signal },
);
assertEqual(actionParses, 0, 'M07: server action input parsing must remain lazy before subscription.');
assertEqual(actionExecutions, 0, 'M07: server action handler must remain lazy before subscription.');
assertEqual(await firstValueFrom(lazyAction$), 42, 'M07: server action should emit its typed result.');
assertEqual(actionParses, 1, 'M07: server action input should be parsed once per subscription.');
assertEqual(actionExecutions, 1, 'M07: server action handler should execute once per subscription.');

const createTodoActionResponse = await app.request('/api/actions/todos.create', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ title: 'Prove M07 server actions' }),
});
assertEqual(createTodoActionResponse.status, 201, 'M07: create-todo server action should return HTTP 201.');
const createdTodo = (await createTodoActionResponse.json()) as {
  readonly id: number;
  readonly title: string;
};
assertEqual(createdTodo.title, 'Prove M07 server actions', 'M07: server action should return the created Todo.');

const todosAfterAction = await app.request('/api/todos');
const todosAfterActionJson = (await todosAfterAction.json()) as ReadonlyArray<{
  readonly id: number;
  readonly title: string;
}>;
assert(
  todosAfterActionJson.some((todo) => todo.id === createdTodo.id),
  'M07: server action mutation should be visible through the todos query endpoint.',
);

const invalidActionResponse = await app.request('/api/actions/todos.create', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ title: '   ' }),
});
assertEqual(invalidActionResponse.status, 400, 'M07: invalid server-action input should return HTTP 400.');

const legacyMutationResponse = await app.request('/api/todos', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ title: 'legacy mutation path' }),
});
assertEqual(
  legacyMutationResponse.status,
  404,
  'M07: Todo creation should no longer use the ad-hoc POST /api/todos endpoint.',
);

console.log('M01-M13 verification passed.');
