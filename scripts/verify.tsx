import { defer, filter, firstValueFrom, map, of } from 'rxjs';
import { buildPath, createRoute, type PathParams } from 'rxjs-router';

import {
  QUERY_STATE_SCRIPT_ID,
  QueryClient,
  dehydrate,
  hydrateQueryClientFromDocument,
  queryOptions,
} from '../src/query';
import { renderToString } from '../src/render/html';
import { generatedRouteFiles, routes } from '../src/routes.generated';
import { executeServerAction$ } from '../src/server/action';
import { app } from '../src/server/app';
import { collectStaticPathnames, renderStaticPage, staticOutputPath } from '../src/ssg/static';
import { createTodosSampleApp } from './serve-todos';

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
assertEqual(
  await firstValueFrom(lazyHtml$),
  '<p>lazy</p>',
  'M03: SSR pipeline should render HTML.',
);
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
assert(
  counterBody.includes('<h1>RxJS Fullstack Counter</h1>'),
  'M05: router should render nested counter route.',
);

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
assertEqual(
  accountResponse.status,
  302,
  'M12: protected account route should redirect anonymous requests.',
);

const health = await app.request('/health');
assertEqual(health.status, 200, 'M04: health route should return HTTP 200.');
assertEqual(await health.text(), '{"ok":true}', 'M04: health route should return JSON.');

const typedParams: PathParams<'/teams/$teamId/users/$userId'> = {
  teamId: 'rxjs',
  userId: '42',
};
assertEqual(typedParams.teamId, 'rxjs', 'M05: route path should infer teamId.');
assertEqual(typedParams.userId, '42', 'M05: route path should infer userId.');

assertEqual(
  buildPath({ path: '/hello/$name', params: { name: 'Erik Meijer' } }),
  '/hello/Erik%20Meijer',
  'M05: buildPath should require and encode path-derived params.',
);

let hrefMissingParamRejected = false;
try {
  // @ts-expect-error M05: buildPath requires the path-derived "name" parameter.
  buildPath({ path: '/hello/$name', params: {} });
} catch {
  hrefMissingParamRejected = true;
}
assert(hrefMissingParamRejected, 'M05: buildPath should throw when a path param is missing.');

let hrefWrongParamRejected = false;
try {
  // @ts-expect-error M05: buildPath rejects unrelated parameter names.
  buildPath({ path: '/hello/$name', params: { id: 'Erik' } });
} catch {
  hrefWrongParamRejected = true;
}
assert(hrefWrongParamRejected, 'M05: buildPath should throw for unrelated parameter names.');

const helloResponse = await app.request('/hello/Erik%20Meijer');
assertEqual(helloResponse.status, 200, 'M05: hello route should return HTTP 200.');
const helloBody = await helloResponse.text();
assert(
  helloBody.includes('<h1>Hello Erik Meijer</h1>'),
  'M05: hello route should render the decoded path param.',
);
assert(
  helloBody.includes('<title>Hello Erik Meijer</title>'),
  'M05: hello route title should derive from the param.',
);
assert(
  generatedRouteFiles.includes('hello.tsx'),
  'M06: the hello route should be a discovered route module, not manual registration.',
);

const todosResponse = await app.request('/todos');
assertEqual(todosResponse.status, 200, 'M05-M13: todos route should return HTTP 200.');
const todosBody = await todosResponse.text();
assert(
  todosBody.includes('<h1>RxJS Fullstack Todos</h1>'),
  'M05: todos route should render SSR HTML.',
);
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
assert(
  Array.isArray(todosJson) && todosJson.length > 0,
  'M05: todos API should return seeded todos.',
);

// M05 Query/Cache behavior: the reactive query surface must stay lazy, dedupe
// concurrent subscribers, serve fresh cache hits without refetching, refetch
// on invalidation, release unobserved queries per gcTime, and keep mutations
// cold until subscription.
const behaviorClient = new QueryClient();

let dedupExecutions = 0;
const dedupQuery = queryOptions({
  queryKey: ['m05-dedup'] as const,
  staleTime: 60_000,
  queryFn: async () => {
    dedupExecutions += 1;
    return dedupExecutions;
  },
});

const dedup$ = behaviorClient.query$(dedupQuery);
assertEqual(dedupExecutions, 0, 'M05: query$ must remain lazy before subscription.');

const [firstDedup, secondDedup] = await Promise.all([
  firstValueFrom(dedup$.pipe(filter((result) => result.isSuccess))),
  firstValueFrom(dedup$.pipe(filter((result) => result.isSuccess))),
]);
assertEqual(
  dedupExecutions,
  1,
  'M05: concurrent subscriptions with one query key should share a single queryFn execution.',
);
assertEqual(
  firstDedup.data,
  1,
  'M05: the first subscriber should receive the shared fetch result.',
);
assertEqual(
  secondDedup.data,
  1,
  'M05: the second subscriber should receive the shared fetch result.',
);

const cachedDedup = await firstValueFrom(dedup$.pipe(filter((result) => result.isSuccess)));
assertEqual(
  dedupExecutions,
  1,
  'M05: a fresh cached query should be served without a new queryFn execution.',
);
assertEqual(cachedDedup.data, 1, 'M05: a later subscriber should receive the cached value.');

let invalidationExecutions = 0;
const invalidationQuery = queryOptions({
  queryKey: ['m05-invalidate'] as const,
  staleTime: 60_000,
  queryFn: async () => {
    invalidationExecutions += 1;
    return invalidationExecutions;
  },
});

const invalidation$ = behaviorClient.query$(invalidationQuery);
let refetchedValue: number | undefined;
const invalidationSub = invalidation$.subscribe((result) => {
  if (result.isSuccess && result.data === 2) {
    refetchedValue = result.data;
  }
});
await firstValueFrom(invalidation$.pipe(filter((result) => result.isSuccess)));
assertEqual(invalidationExecutions, 1, 'M05: an observed query should fetch once on mount.');

await firstValueFrom(behaviorClient.invalidateQueries({ queryKey: invalidationQuery.queryKey }));
assertEqual(
  invalidationExecutions,
  2,
  'M05: invalidateQueries should refetch the actively observed query.',
);
await new Promise((resolve) => setTimeout(resolve, 0));
assertEqual(
  refetchedValue,
  2,
  'M05: the standing subscription should receive the refetched value.',
);
invalidationSub.unsubscribe();

let gcExecutions = 0;
const gcQuery = queryOptions({
  queryKey: ['m05-gc'] as const,
  gcTime: 0,
  queryFn: async () => {
    gcExecutions += 1;
    return gcExecutions;
  },
});
await firstValueFrom(behaviorClient.query$(gcQuery).pipe(filter((result) => result.isSuccess)));
assertEqual(gcExecutions, 1, 'M05: the gc probe query should have fetched once while observed.');
await new Promise((resolve) => setTimeout(resolve, 10));
assertEqual(
  behaviorClient.queryCache.find({ queryKey: gcQuery.queryKey }),
  undefined,
  'M05: an unobserved query should be garbage-collected from the cache after gcTime.',
);

let mutationExecutions = 0;
let mutationSettled = 0;
const doubler = behaviorClient.mutation<number, Error, number>({
  mutationFn: async (value) => {
    mutationExecutions += 1;
    return value * 2;
  },
  onSettled: () => {
    mutationSettled += 1;
  },
});

const doubled$ = doubler.mutate$(21);
assertEqual(mutationExecutions, 0, 'M05: mutate$ must remain lazy before subscription.');
assertEqual(await firstValueFrom(doubled$), 42, 'M05: mutate$ should emit the mutation result.');
assertEqual(
  mutationExecutions,
  1,
  'M05: one mutate$ subscription should run the mutation exactly once.',
);
assertEqual(mutationSettled, 1, 'M05: onSettled should run after the mutation completes.');

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
    id === QUERY_STATE_SCRIPT_ID ? { textContent: JSON.stringify(dehydratedState) } : null,
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
assertEqual(
  actionParses,
  0,
  'M07: server action input parsing must remain lazy before subscription.',
);
assertEqual(
  actionExecutions,
  0,
  'M07: server action handler must remain lazy before subscription.',
);
assertEqual(
  await firstValueFrom(lazyAction$),
  42,
  'M07: server action should emit its typed result.',
);
assertEqual(actionParses, 1, 'M07: server action input should be parsed once per subscription.');
assertEqual(
  actionExecutions,
  1,
  'M07: server action handler should execute once per subscription.',
);

const createTodoActionResponse = await app.request('/api/actions/todos.create', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ title: 'Prove M07 server actions' }),
});
assertEqual(
  createTodoActionResponse.status,
  201,
  'M07: create-todo server action should return HTTP 201.',
);
const createdTodo = (await createTodoActionResponse.json()) as {
  readonly id: number;
  readonly title: string;
};
assertEqual(
  createdTodo.title,
  'Prove M07 server actions',
  'M07: server action should return the created Todo.',
);

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
assertEqual(
  invalidActionResponse.status,
  400,
  'M07: invalid server-action input should return HTTP 400.',
);

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

const todosSampleApp = createTodosSampleApp();
const todosSamplePage = await todosSampleApp.request('/');
assertEqual(todosSamplePage.status, 200, 'Todos sample: the harness page should return HTTP 200.');
const todosSampleHtml = await todosSamplePage.text();
assert(
  todosSampleHtml.includes('<div id="app">'),
  'Todos sample: the harness page should provide the #app mount element.',
);
assert(
  todosSampleHtml.includes('src="/client/todos-client.js"'),
  'Todos sample: the harness page should load the built browser bundle.',
);
const todosSampleApi = await todosSampleApp.request('/api/todos');
assertEqual(
  todosSampleApi.status,
  200,
  'Todos sample: the harness should expose the todos API on the same origin.',
);
const todosSampleDeepLink = await todosSampleApp.request('/todos');
const todosSampleDeepLinkHtml = await todosSampleDeepLink.text();
assert(
  todosSampleDeepLinkHtml.includes('src="/client/todos-client.js"'),
  'Todos sample: page routes should serve the client mount page so deep links stay in the client app.',
);

console.log('M01-M13 verification passed.');
