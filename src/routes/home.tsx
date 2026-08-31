import { createChildRoute } from 'rxjs-router';

import { HomePage } from '../examples/home';
import { rootBaseRoute } from './root';
import type { PageData } from './types';

export const homeRoute = createChildRoute<typeof rootBaseRoute>()({
  id: 'home',
  path: '/',
  loader: ({ parentData }): PageData => {
    const title = parentData.appName;

    return {
      title,
      view: <HomePage title={title} milestone="M01-M13 vertical slice with streaming SSR" />,
    };
  },
});

export default homeRoute;
