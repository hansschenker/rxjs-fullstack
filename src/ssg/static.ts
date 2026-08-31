import { normalizeRoutes, type AnyRoute, type RouteNode } from 'rxjs-router';

import { renderRouteDocument, type RenderRouteDocumentOptions } from '../render/page';

const STATIC_ORIGIN = 'http://rxjs-fullstack.static';

const hasBuildTimeParams = (pathname: string): boolean => pathname.includes('$');

export const collectStaticPathnames = (routes: readonly AnyRoute[]): readonly string[] => {
  const pathnames = new Set<string>();

  const visit = (node: RouteNode): void => {
    if (!hasBuildTimeParams(node.fullPath)) {
      pathnames.add(node.fullPath);
    }

    node.children.forEach(visit);
  };

  normalizeRoutes(routes).forEach(visit);

  return [...pathnames].sort((left, right) => left.localeCompare(right));
};

export const staticOutputPath = (pathname: string): string => {
  if (!pathname.startsWith('/')) {
    throw new TypeError(`Static pathname must start with "/": ${pathname}`);
  }

  const normalized = pathname.replace(/\/+$/, '') || '/';
  const relativePath = normalized.slice(1);

  return relativePath ? `dist/static/${relativePath}/index.html` : 'dist/static/index.html';
};

export interface StaticPage {
  readonly pathname: string;
  readonly outputPath: string;
  readonly html: string;
}

export interface RenderStaticPageOptions {
  readonly routes: RenderRouteDocumentOptions['routes'];
  readonly pathname: string;
  readonly fetch: RenderRouteDocumentOptions['fetch'];
  readonly origin?: string;
}

export const renderStaticPage = async ({
  routes,
  pathname,
  fetch,
  origin = STATIC_ORIGIN,
}: RenderStaticPageOptions): Promise<StaticPage> => {
  if (hasBuildTimeParams(pathname)) {
    throw new Error(
      `Cannot statically render parameterized pathname without build-time params: ${pathname}`,
    );
  }

  const result = await renderRouteDocument({
    routes,
    request: new Request(new URL(pathname, origin)),
    fetch,
  });

  if (result.type !== 'page') {
    throw new Error(
      `Static generation for "${pathname}" produced ${result.type} instead of a page.`,
    );
  }

  return {
    pathname,
    outputPath: staticOutputPath(pathname),
    html: result.html,
  };
};
