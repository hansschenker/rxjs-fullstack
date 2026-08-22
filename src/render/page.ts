import { resolveRequest, type AnyRoute } from 'rxjs-router';

import type { ResolvedAuthSession } from '../auth/types';
import {
  QUERY_STATE_SCRIPT_ID,
  QueryClient,
  dehydrate,
} from '../query';
import type { PageData } from '../routes/types';
import type { ServerRouteContext } from '../server/route-context';
import { renderDocument, renderToString } from './html';

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

export interface RenderRouteDocumentOptions {
  readonly routes: readonly AnyRoute[];
  readonly request: Request;
  readonly fetch: ServerRouteContext['fetch'];
  readonly auth?: ResolvedAuthSession | null;
}

export const renderRouteDocument = async ({
  routes,
  request,
  fetch,
  auth = null,
}: RenderRouteDocumentOptions): Promise<RouteDocumentResult> => {
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

  const page = result.match.data as PageData;
  const body = renderToString(page.view);
  const html = renderDocument({
    title: page.title,
    body,
    jsonScripts: [
      {
        id: QUERY_STATE_SCRIPT_ID,
        value: dehydrate(queryClient),
      },
    ],
  });

  return {
    type: 'page',
    statusCode: 200,
    title: page.title,
    html,
  };
};
