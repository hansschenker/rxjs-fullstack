import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { routes } from '../src/routes';
import { app } from '../src/server/app';
import type { ServerRouteContext } from '../src/server/route-context';
import { collectStaticPathnames, renderStaticPage } from '../src/ssg/static';

declare global {
  interface ImportMeta {
    readonly dir: string;
  }
}

const projectRoot = join(import.meta.dir, '..');
const outputRoot = join(projectRoot, 'dist', 'static');

const fetchFromApp: ServerRouteContext['fetch'] = async (input, init) => {
  const url = new URL(input, 'http://rxjs-fullstack.static');
  return app.request(`${url.pathname}${url.search}`, init);
};

await rm(outputRoot, { recursive: true, force: true });

const pathnames = collectStaticPathnames(routes);

for (const pathname of pathnames) {
  const page = await renderStaticPage({
    routes,
    pathname,
    fetch: fetchFromApp,
  });
  const outputFile = join(projectRoot, page.outputPath);

  await mkdir(dirname(outputFile), { recursive: true });
  await writeFile(outputFile, page.html);
  console.log(`${pathname} -> ${page.outputPath}`);
}

console.log(`Generated ${pathnames.length} static pages.`);

export {};
