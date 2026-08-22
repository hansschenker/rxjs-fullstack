import { createChildRoute } from 'rxjs-router';

import { rootBaseRoute } from './root';
import type { PageData } from './types';

export const helloRoute = createChildRoute<typeof rootBaseRoute>()({
  id: 'hello',
  path: 'hello/$name',
  loader: ({ params }): PageData => ({
    title: `Hello ${params.name}`,
    view: (
      <main>
        <h1>Hello {params.name}</h1>
        <p>The route parameter was inferred from the path literal.</p>
      </main>
    ),
  }),
});

export default helloRoute;
