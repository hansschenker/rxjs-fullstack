import { firstValueFrom, map, toArray } from 'rxjs';
import { resolveRequest, type AnyRoute } from 'rxjs-router';

import type { ResolvedAuthSession } from '../auth/types';
import {
  QUERY_STATE_SCRIPT_ID,
  QueryClient,
  dehydrate,
} from '../query';
import type { PageData } from '../routes/types';
import type { ServerRouteContext } from '../server/route-context';
import {
  renderDocument,
  renderDocumentStream,
  renderToString,
} from './html';

export type RouteDocumentResult =
  | {
      readonly type: 'page';
      readonly statusCode: 200;
      readonly title: string;
      readonly html: string;
    }
  | {
      readonly type: 'redirect';
      readonly statusCode: number;
      readonly location: string;
    }
  | {
      readonly type: 'notFound';
      readonly statusCode: 404;
    }
  | {
      readonly type: 'error';
      readonly statusCode: number;
      readonly error: unknown;
    };

export type RouteResponseResult =
  | RouteDocumentResult
  | {
      readonly type: 'stream';
      readonly statusCode: 200;
      readonly title: string;
      readonly body: ReadableStream<Uint8Array>;
    };

export interface RenderRouteDocumentOptions {
  readonly routes: readonly AnyRoute[];
  readonly request: Request;
  readonly fetch: ServerRouteContext['fetch'];
  readonly auth?: ResolvedAuthSession | null;
}

type RouteResolutionResult =
  | {
      readonly type: 'pagePlan';
      readonly page: PageData;
      readonly queryClient: QueryClient;
    }
  | Exclude<RouteDocumentResult, { readonly type: 'page' }>;

const resolveRoutePage = async ({
  routes,
  request,
  fetch,
  auth = null,
}: RenderRouteDocumentOptions): Promise<RouteResolutionResult> => {
  const queryClient = new QueryClient();
  const routeContext: ServerRouteContext = {
    queryClient,
    fetch,
    auth,
  };

  const result = await resolveRequest({
    routes,
    request,
    context: routeContext,
  });

  if (result.type === 'redirect') {
    return {
      type: 'redirect',
      statusCode: result.statusCode,
      location: result.location,
    };
  }

  if (result.type === 'notFound') {
    return { type: 'notFound', statusCode: 404 };
  }

  if (result.type === 'error') {
    return {
      type: 'error',
      statusCode: result.statusCode,
      error: result.error,
    };
  }

  return {
    type: 'pagePlan',
    page: result.match.data as PageData,
    queryClient,
  };
};

const queryStateScripts = (queryClient: QueryClient) => [
  {
    id: QUERY_STATE_SCRIPT_ID,
    value: dehydrate(queryClient),
  },
] as const;

const renderBufferedPage = async (
  page: PageData,
  queryClient: QueryClient,
): Promise<RouteDocumentResult> => {
  try {
    let body = renderToString(page.view);

    if (page.stream$) {
      const streamedBody = await firstValueFrom(
        page.stream$.pipe(map(renderToString), toArray()),
      );
      body += streamedBody.join('');
    }

    return {
      type: 'page',
      statusCode: 200,
      title: page.title,
      html: renderDocument({
        title: page.title,
        body,
        jsonScripts: queryStateScripts(queryClient),
      }),
    };
  } catch (error) {
    return {
      type: 'error',
      statusCode: 500,
      error,
    };
  }
};

export const renderRouteDocument = async (
  options: RenderRouteDocumentOptions,
): Promise<RouteDocumentResult> => {
  const result = await resolveRoutePage(options);
  if (result.type !== 'pagePlan') {
    return result;
  }
  return renderBufferedPage(result.page, result.queryClient);
};

export const renderRouteResponse = async (
  options: RenderRouteDocumentOptions,
): Promise<RouteResponseResult> => {
  const result = await resolveRoutePage(options);
  if (result.type !== 'pagePlan') {
    return result;
  }

  const { page, queryClient } = result;
  if (!page.stream$) {
    return renderBufferedPage(page, queryClient);
  }

  try {
    return {
      type: 'stream',
      statusCode: 200,
      title: page.title,
      body: renderDocumentStream({
        title: page.title,
        initialBody: renderToString(page.view),
        body$: page.stream$.pipe(map(renderToString)),
        jsonScripts: () => queryStateScripts(queryClient),
      }),
    };
  } catch (error) {
    return {
      type: 'error',
      statusCode: 500,
      error,
    };
  }
};
