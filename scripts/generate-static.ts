import { routes } from '../src/routes';
import { app } from '../src/server/app';
import type { ServerRouteContext } from '../src/server/route-context';
import {
  collectStaticPathnames,
  renderStaticPage,
} from '../src/ssg/static';

declare global {
  interface ImportMeta {
    readonly dir: string;
  }
}

declare const Bun: {
  readonly $: (
    strings: TemplateStringsArray,
    ...expressions: unknown[]
  ) => Promise<unknown>;
  write(path: string, data: string): Promise<number>;
};

const projectRoot = `${import.meta.dir}/..`;
const outputRoot = `${projectRoot}/dist/static`;

const fetchFromApp: ServerRouteContext['fetch'] = async (input, init) => {
  const url = new URL(input, 'http://rxjs-fullstack.static');
  return app.request(`${url.pathname}${url.search}`, init);
};

await Bun.$`rm -rf ${outputRoot}`;

const pathnames = collectStaticPathnames(routes);

for (const pathname of pathnames) {
  const page = await renderStaticPage({
    routes,
    pathname,
    fetch: fetchFromApp,
  });
  const outputFile = `${projectRoot}/${page.outputPath}`;
  const outputDirectory = outputFile.slice(0, outputFile.lastIndexOf('/'));

  await Bun.$`mkdir -p ${outputDirectory}`;
  await Bun.write(outputFile, page.html);
  console.log(`${pathname} -> ${page.outputPath}`);
}

console.log(`Generated ${pathnames.length} static pages.`);

export {};
