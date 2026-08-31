import { createChildRoute } from 'rxjs-router';

import { Counter } from '../examples/counter';
import { rootBaseRoute } from './root';
import type { PageData } from './types';

const CounterView = () => {
  if (typeof document === 'undefined') {
    return <button type="button">Count: 0</button>;
  }

  return <Counter />;
};

export const counterRoute = createChildRoute<typeof rootBaseRoute>()({
  id: 'counter',
  path: 'counter',
  loader: ({ parentData }): PageData => ({
    title: `${parentData.appName} Counter`,
    view: (
      <main>
        <h1>{parentData.appName} Counter</h1>
        <p>Client-side navigation is powered by rxjs-router.</p>
        <CounterView />
      </main>
    ),
  }),
});

export default counterRoute;
