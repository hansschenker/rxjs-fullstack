import { QUERY_STATE_SCRIPT_ID } from '../src/query';
import { routes } from '../src/routes';
import { app } from '../src/server/app';
import { collectStaticPathnames, staticOutputPath } from '../src/ssg/static';

declare global {
  interface ImportMeta {
    readonly dir: string;
  }
}

declare const Bun: {
  file(path: string): {
    exists(): Promise<boolean>;
    text(): Promise<string>;
  };
};

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

const projectRoot = `${import.meta.dir}/..`;
const pathnames = collectStaticPathnames(routes);

for (const pathname of pathnames) {
  const outputPath = staticOutputPath(pathname);
  const outputFile = `${projectRoot}/${outputPath}`;
  assert(await Bun.file(outputFile).exists(), `M09: static build should write ${outputPath}.`);
}

const aboutFile = `${projectRoot}/${staticOutputPath('/about')}`;
const aboutStaticHtml = await Bun.file(aboutFile).text();
const aboutSsrResponse = await app.request('/about');
const aboutSsrHtml = await aboutSsrResponse.text();
assertEqual(
  aboutStaticHtml,
  aboutSsrHtml,
  'M09: static /about output should be byte-for-byte equivalent to request-time SSR.',
);

const todosFile = `${projectRoot}/${staticOutputPath('/todos')}`;
const todosStaticHtml = await Bun.file(todosFile).text();
assert(
  todosStaticHtml.includes('Port TanStack Query to RxJS'),
  'M09: static /todos should contain build-time prefetched query data.',
);
assert(
  !todosStaticHtml.includes('Loading todos...'),
  'M09: static /todos should not contain the client loading placeholder.',
);
assert(
  todosStaticHtml.includes(`id="${QUERY_STATE_SCRIPT_ID}"`),
  'M09: static /todos should carry dehydrated Query/Cache state.',
);
assert(
  todosStaticHtml.includes('"queryKey":["todos"]'),
  'M09: static /todos bootstrap should contain the Todos query identity.',
);

const streamingFile = `${projectRoot}/${staticOutputPath('/streaming')}`;
const streamingStaticHtml = await Bun.file(streamingFile).text();
assert(
  streamingStaticHtml.includes('id="streaming-shell"') &&
    streamingStaticHtml.includes('id="streaming-progress"') &&
    streamingStaticHtml.includes('id="streaming-todos"'),
  'M13: SSG should buffer all progressive streaming phases into one complete static document.',
);
assert(
  streamingStaticHtml.includes('"queryKey":["todos"]'),
  'M13: buffered static streaming page should retain final dehydrated Query/Cache state.',
);

console.log('M09-M13 static output verification passed.');

export {};
