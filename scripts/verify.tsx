import { defer, firstValueFrom, map, of } from 'rxjs';

import { app } from '../src/server/app';
import { Fragment, jsx } from '../src/jsx/runtime';
import { renderToString } from '../src/render/html';

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
assertEqual(response.status, 200, 'M04: root route should return HTTP 200.');
const body = await response.text();
assert(body.includes('<h1>RxJS Fullstack</h1>'), 'M04: root route should return SSR HTML.');
assert(body.includes('M01–M04 vertical slice'), 'M04: SSR route should render route data.');

const health = await app.request('/health');
assertEqual(health.status, 200, 'M04: health route should return HTTP 200.');
assertEqual(await health.text(), '{"ok":true}', 'M04: health route should return JSON.');

console.log('M01-M04 verification passed.');
