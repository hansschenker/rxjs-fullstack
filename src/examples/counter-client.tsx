import { map } from 'rxjs';
import { createBrowserHistory, createRouter } from 'rxjs-router';

import { Fragment, jsx, type ViewChild } from '../jsx/runtime';
import { mount } from '../render/dom';
import { routes, type AppRoutes, type PageData } from '../routes';

const root = document.querySelector('#app');

if (!(root instanceof Element)) {
  throw new Error('Expected #app mount element.');
}

const router = createRouter<AppRoutes>({
  routes,
  history: createBrowserHistory(),
});

type AppRouterState = typeof router.state;

const app$ = router.state$.pipe(
  map<AppRouterState, ViewChild>((state) => {
    if (state.status === 'pending') {
      return <main><p>Loading...</p></main>;
    }

    if (state.status === 'notFound') {
      return <main><h1>Not found</h1></main>;
    }

    if (state.status === 'error') {
      return <main><h1>Something went wrong</h1></main>;
    }

    const page = state.matches.at(-1)?.data as PageData | undefined;
    return page?.view ?? null;
  }),
);

const lifetime = mount(app$, root);
window.addEventListener('pagehide', () => lifetime.unsubscribe(), { once: true });
