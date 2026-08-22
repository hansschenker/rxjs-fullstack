import { createChildRoute } from 'rxjs-router';

import { HomePage } from '../examples/home';
import { Fragment, jsx } from '../jsx/runtime';
import { rootBaseRoute } from './root';
import type { PageData } from './types';

export const homeRoute = createChildRoute<typeof rootBaseRoute>()({
  id: 'home',
  path: '/',
  loader: ({ parentData }): PageData => {
    const title = parentData.appName;

    return {
      title,
      view: (
        <HomePage
          title={title}
          milestone="M01-M10 vertical slice with runtime adapters"
        />
      ),
    };
  },
});

export default homeRoute;
