import { defer, firstValueFrom, map, type Observable } from 'rxjs';
import type { Hono } from 'hono';

import type { ViewChild } from '../jsx/runtime';
import { renderDocument, renderToString } from '../render/html';

type SegmentParam<Segment extends string> = Segment extends `:${infer Name}`
  ? Name
  : never;

type RouteParamNames<Path extends string> = Path extends `${infer Segment}/${infer Rest}`
  ? SegmentParam<Segment> | RouteParamNames<Rest>
  : SegmentParam<Path>;

export type RouteParams<Path extends string> = [RouteParamNames<Path>] extends [never]
  ? Readonly<Record<string, never>>
  : Readonly<{ [Name in RouteParamNames<Path>]: string }>;

export interface RouteLoadContext<Path extends string> {
  readonly request: Request;
  readonly url: URL;
  readonly params: RouteParams<Path>;
}

export interface PageRouteConfig<Path extends string, Model> {
  readonly load: (context: RouteLoadContext<Path>) => Observable<Model>;
  readonly view: (model: Model) => ViewChild;
  readonly title: string | ((model: Model) => string);
}

export interface PageRoute<Path extends string, Model>
  extends PageRouteConfig<Path, Model> {
  readonly path: Path;
  readonly href: (params: RouteParams<Path>) => string;
}

export const buildRoutePath = <const Path extends string>(
  path: Path,
  params: RouteParams<Path>,
): string =>
  path
    .split('/')
    .map((segment) => {
      if (!segment.startsWith(':')) {
        return segment;
      }

      const paramName = segment.slice(1);
      const value = (params as Readonly<Record<string, string>>)[paramName];

      if (value === undefined) {
        throw new TypeError(`Missing route parameter "${paramName}" for path "${path}".`);
      }

      return encodeURIComponent(value);
    })
    .join('/');

export const definePageRoute =
  <const Path extends string>(path: Path) =>
  <Model>(config: PageRouteConfig<Path, Model>): PageRoute<Path, Model> => ({
    path,
    ...config,
    href: (params) => buildRoutePath(path, params),
  });

const resolveTitle = <Model>(
  title: string | ((model: Model) => string),
  model: Model,
): string => (typeof title === 'function' ? title(model) : title);

export const registerPageRoute = <const Path extends string, Model>(
  app: Hono,
  route: PageRoute<Path, Model>,
): void => {
  app.get(route.path, async (context) => {
    // Hono performs the runtime path match. This is the one framework boundary
    // where its string-keyed params are lifted into the path-derived TS type.
    const params = context.req.param() as unknown as RouteParams<Path>;

    const loadContext: RouteLoadContext<Path> = {
      request: context.req.raw,
      url: new URL(context.req.url),
      params,
    };

    const document$ = defer(() => route.load(loadContext)).pipe(
      map((model) => ({
        model,
        body: renderToString(route.view(model)),
      })),
      map(({ model, body }) =>
        renderDocument({
          title: resolveTitle(route.title, model),
          body,
        }),
      ),
    );

    return context.html(await firstValueFrom(document$));
  });
};
