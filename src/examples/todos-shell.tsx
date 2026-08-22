import { Subject, concatMap, filter, from, map, tap } from 'rxjs';
import type { Observable } from 'rxjs';
import { createBrowserHistory, createRouter, type RxRouter } from 'rxjs-router';

import { Fragment, jsx, type ViewChild } from '../jsx/runtime';
import { routes, type AppRoutes, type PageData } from '../routes';

export interface TodosShell {
  readonly view: ViewChild;
  /**
   * Link clicks flow through this dataflow: preventDefault, read the anchor
   * href, and hand it to the router. Subscribing arms navigation; the
   * subscription belongs to the mounted view's lifetime.
   */
  readonly navigation$: Observable<void>;
  readonly router: RxRouter<AppRoutes>;
}

/**
 * Browser shell for the Todos sample: the router's state stream is the live
 * application view source, and navigation is client-side — nav link clicks
 * enter a Subject, the dataflow calls `router.navigateHref()`, and the next
 * page view arrives through `router.state$` like any other live region.
 */
export const createTodosShell = (): TodosShell => {
  const router = createRouter<AppRoutes>({
    routes,
    history: createBrowserHistory(),
  });

  const navClick$ = new Subject<MouseEvent>();

  const navigation$ = navClick$.pipe(
    tap((event) => event.preventDefault()),
    map((event) =>
      event.currentTarget instanceof HTMLAnchorElement
        ? event.currentTarget.getAttribute('href')
        : null,
    ),
    filter((href): href is string => typeof href === 'string'),
    concatMap((href) => from(router.navigateHref(href))),
  );

  const page$ = router.state$.pipe(
    tap((state) => {
      const page = state.matches.at(-1)?.data as PageData | undefined;
      if (page) {
        document.title = page.title;
      }
    }),
    map((state): ViewChild => {
      if (state.status === 'pending') {
        return <p>Loading...</p>;
      }

      if (state.status === 'notFound') {
        return <h1>Not found</h1>;
      }

      if (state.status === 'error') {
        return <h1>Something went wrong</h1>;
      }

      const page = state.matches.at(-1)?.data as PageData | undefined;
      return page?.view ?? null;
    }),
  );

  const NavLink = ({ href, label }: { readonly href: string; readonly label: string }) => (
    <a href={href} on={{ click: navClick$ }}>
      {label}
    </a>
  );

  const view = (
    <div>
      <nav>
        <NavLink href="/" label="Home" /> <NavLink href="/about" label="About" />{' '}
        <NavLink href="/counter" label="Counter" /> <NavLink href="/todos" label="Todos" />{' '}
        <NavLink href="/hello/RxJS" label="Hello" />
      </nav>
      {page$}
    </div>
  );

  return { view, navigation$, router };
};
