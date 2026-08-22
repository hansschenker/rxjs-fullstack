import { defer, firstValueFrom, map, of } from 'rxjs';

import { helloRoute } from '../src/examples/routes';
import { Fragment, jsx } from '../src/jsx/runtime';
import { generatedRouteFiles } from '../src/routes.generated';
import { renderToString } from '../src/render/html';
import type { RouteParams } from '../src/router/route';
import { app } from '../src/server/app';

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
assertEqual(response.status, 200, 'M04-M06: root route should return HTTP 200.');
const body = await response.text();
assert(body.includes('<h1>RxJS Fullstack</h1>'), 'M04: root route should return SSR HTML.');
assert(
  body.includes('M01-M06 vertical slice with file-based route discovery'),
  'M06: SSR route should render generated route-tree data.',
);

const counterResponse = await app.request('/counter');
assertEqual(counterResponse.status, 200, 'M05/M06: counter route should return HTTP 200.');
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

// These are compile-time assertions (tsc must report an error on each call)
// AND runtime assertions: href throws when the path param is missing.
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
assertEqual(todosResponse.status, 200, 'M05/M06: todos route should return HTTP 200.');
const todosBody = await todosResponse.text();
assert(todosBody.includes('<h1>RxJS Fullstack Todos</h1>'), 'M05: todos route should render SSR HTML.');

const todosApi = await app.request('/api/todos');
assertEqual(todosApi.status, 200, 'M05: todos API should return HTTP 200.');
const todosJson = (await todosApi.json()) as ReadonlyArray<{ readonly id: number }>;
assert(Array.isArray(todosJson) && todosJson.length > 0, 'M05: todos API should return seeded todos.');

console.log('M01-M06 verification passed.');
