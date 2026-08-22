import { createChildRoute } from 'rxjs-router';

import { rootBaseRoute } from './root';
import type { PageData } from './types';

export const aboutRoute = createChildRoute<typeof rootBaseRoute>()({
  id: 'about',
  path: 'about',
  loader: ({ parentData }): PageData => ({
    title: `${parentData.appName} About`,
    view: (
      <main>
        <h1>About {parentData.appName}</h1>
        <p>This route was discovered from the src/routes directory.</p>
      </main>
    ),
  }),
});

export default aboutRoute;
