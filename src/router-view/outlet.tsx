import { map, tap, type Observable } from 'rxjs';
import type { AnyRoute, RouteMatch, RouterState, RxRouter } from 'rxjs-router';

import type { ViewChild } from '../jsx/runtime';
import { routeComponentOutputFrom, type RouteComponentOutput } from './output';

export type RouterOutletDepth = number | 'leaf';

export interface RouterOutletProps<TRoutes extends readonly AnyRoute[] = readonly AnyRoute[]> {
  readonly router: RxRouter<TRoutes>;
  /**
   * Which depth of the active branch to render.
   *
   * - 'leaf' renders the deepest matched route and preserves the old page$
   *   behavior.
   * - 0, 1, 2... render a specific outlet depth for nested layouts.
   */
  readonly depth?: RouterOutletDepth;
  readonly pending?: ViewChild;
  readonly notFound?: ViewChild;
  readonly error?: (error: unknown) => ViewChild;
  readonly empty?: ViewChild;
  /**
   * By default, RouterOutlet mirrors the old page$ title side effect in browser
   * shells. Pass false when a caller wants to manage document.title itself.
   */
  readonly documentTitle?: boolean | ((output: RouteComponentOutput) => string | undefined);
}

export type CreateRouterOutletViewOptions<
  TRoutes extends readonly AnyRoute[] = readonly AnyRoute[],
> = RouterOutletProps<TRoutes>;

const selectMatch = (
  matches: readonly RouteMatch[],
  depth: RouterOutletDepth,
): RouteMatch | undefined => (depth === 'leaf' ? matches.at(-1) : matches[depth]);

const routeOutputForState = (
  state: RouterState<RouteMatch>,
  depth: RouterOutletDepth,
): RouteComponentOutput | undefined =>
  routeComponentOutputFrom(selectMatch(state.matches, depth)?.data);

export const createRouterOutletView$ = <TRoutes extends readonly AnyRoute[]>({
  router,
  depth = 'leaf',
  pending = <p>Loading...</p>,
  notFound = <h1>Not found</h1>,
  error = () => <h1>Something went wrong</h1>,
  empty = null,
  documentTitle = true,
}: CreateRouterOutletViewOptions<TRoutes>): Observable<ViewChild> => {
  return router.state$.pipe(
    tap((state) => {
      if (
        documentTitle === false ||
        state.status !== 'success' ||
        typeof document === 'undefined'
      ) {
        return;
      }

      const output = routeOutputForState(state as RouterState<RouteMatch>, depth);
      if (!output) {
        return;
      }

      const title = typeof documentTitle === 'function' ? documentTitle(output) : output.title;
      if (title) {
        document.title = title;
      }
    }),
    map((state): ViewChild => {
      if (state.status === 'pending') {
        return pending;
      }

      if (state.status === 'notFound') {
        return notFound;
      }

      if (state.status === 'error') {
        return error(state.error);
      }

      const output = routeOutputForState(state as RouterState<RouteMatch>, depth);
      return output?.view ?? empty;
    }),
  );
};

export function RouterOutlet<TRoutes extends readonly AnyRoute[]>(
  props: RouterOutletProps<TRoutes>,
): ViewChild {
  return createRouterOutletView$(props);
}

/** Short alias for users coming from TanStack Router / React Router vocabulary. */
export const Outlet = RouterOutlet;
