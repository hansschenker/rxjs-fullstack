import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Hono } from 'hono';

import { createBunServerOptions } from '../src/runtime/bun';
import { app } from '../src/server/app';

declare global {
  interface ImportMeta {
    readonly dir: string;
    main: boolean;
  }
}

export const TODOS_SAMPLE_PORT = 3100;

const clientBundlePath = join(
  import.meta.dir,
  '..',
  'dist',
  'client',
  'todos-client.js',
);

const samplePage =
  '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>RxJS Fullstack Todos sample</title></head><body>' +
  '<div id="app"></div>' +
  '<script type="module" src="/client/todos-client.js"></script>' +
  '</body></html>';

/**
 * Dev harness for the browser Todos sample: serves a mount page and the built
 * client bundle, and forwards everything else (the /api and /api/actions
 * endpoints the sample talks to, plus the SSR pages) to the real Hono app.
 */
export const createTodosSampleApp = (): Hono => {
  const sample = new Hono();

  sample.get('/', (context) => context.html(samplePage));

  sample.get('/client/todos-client.js', async (context) => {
    const source = await readFile(clientBundlePath, 'utf8').catch(() => undefined);
    if (source === undefined) {
      return context.text('todos-client.js is not built. Run: bun run build:todos', 404);
    }
    return context.body(source, 200, {
      'content-type': 'text/javascript; charset=utf-8',
    });
  });

  sample.route('/', app);
  return sample;
};

if (import.meta.main) {
  console.log(`Todos sample on http://localhost:${TODOS_SAMPLE_PORT}`);
}

export default createBunServerOptions(TODOS_SAMPLE_PORT, createTodosSampleApp().fetch);
