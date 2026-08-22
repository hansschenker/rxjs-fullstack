import { createChildRoute, redirect } from 'rxjs-router';

import { AccountPage } from '../examples/auth';
import type { ServerRouteContext } from '../server/route-context';
import { rootBaseRoute } from './root';
import type { PageData } from './types';

const isServerRouteContext = (value: unknown): value is ServerRouteContext =>
  typeof value === 'object' &&
  value !== null &&
  'queryClient' in value &&
  'fetch' in value &&
  'auth' in value;

export const accountRoute = createChildRoute<typeof rootBaseRoute>()({
  id: 'account',
  path: 'account/$section',
  loader: ({ parentData, context, params }): PageData => {
    const serverContext = isServerRouteContext(context) ? context : undefined;
    if (!serverContext?.auth) {
      redirect({ to: '/login', statusCode: 302 });
    }

    return {
      title: `${parentData.appName} Account`,
      view: (
        <AccountPage
          user={serverContext.auth.user}
          section={params.section}
          csrfToken={serverContext.auth.csrfToken}
        />
      ),
    };
  },
});

export default accountRoute;
