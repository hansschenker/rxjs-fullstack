import { Hono } from 'hono';
import { defer, firstValueFrom, map, of } from 'rxjs';

import { HomePage } from '../examples/home';
import { Fragment, jsx } from '../jsx/runtime';
import { renderDocument, renderToString } from '../render/html';

const homeDocument$ = defer(() =>
  of({
    title: 'RxJS Fullstack',
    milestone: 'M01–M04 vertical slice',
  }),
).pipe(
  map(HomePage),
  map(renderToString),
  map((body) => renderDocument({ title: 'RxJS Fullstack', body })),
);

export const app = new Hono();

app.get('/health', (context) => context.json({ ok: true }));

app.get('/', async (context) => {
  const html = await firstValueFrom(homeDocument$);
  return context.html(html);
});

export default app;
