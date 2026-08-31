import { distinctUntilChanged, filter, map, shareReplay, type Observable } from 'rxjs';
import type { ParsedLocation, RouteMatch, RxRouter } from 'rxjs-router';

import type { ViewChild } from '../jsx/runtime';
import type { RouteComponentLifecycle } from './lifecycle';

const isDefined = <TValue>(value: TValue | undefined): value is TValue => value !== undefined;

/**
 * Component-facing route context.
 *
 * Loaders keep their existing rxjs-router execution context. Route views get a
 * stream-oriented context owned by RouterOutlet.
 */
export interface RouteViewContext<
  TMatch extends RouteMatch = RouteMatch,
  TRouter extends RxRouter<any, any> = RxRouter<any, any>,
> {
  readonly router: TRouter;
  readonly depth: number;
  readonly match$: Observable<TMatch>;
  readonly matches$: Observable<readonly TMatch[]>;
  readonly params$: Observable<TMatch['params']>;
  readonly search$: Observable<TMatch['search']>;
  readonly data$: Observable<TMatch['data']>;
  readonly location$: Observable<ParsedLocation<TMatch['search']>>;
  readonly hash$: Observable<string>;
  readonly destroy$: Observable<void>;
  readonly parent?: RouteViewContext<RouteMatch, TRouter>;
  readonly child: () => ViewChild;
}

export interface CreateRouteViewContextOptions<TRouter extends RxRouter<any, any>> {
  readonly router: TRouter;
  readonly depth: number;
  readonly lifecycle: RouteComponentLifecycle;
  readonly parent?: RouteViewContext<RouteMatch, TRouter>;
  readonly child?: () => ViewChild;
}

export const createRouteViewContext = <
  TRouter extends RxRouter<any, any>,
  TMatch extends RouteMatch = RouteMatch,
>({
  router,
  depth,
  lifecycle,
  parent,
  child = () => null,
}: CreateRouteViewContextOptions<TRouter>): RouteViewContext<TMatch, TRouter> => {
  const match$ = router.matches$.pipe(
    map((matches) => matches[depth] as TMatch | undefined),
    filter(isDefined),
    distinctUntilChanged(
      (previous, next) => previous.id === next.id && previous.pathname === next.pathname,
    ),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  return {
    router,
    depth,
    match$,
    matches$: router.matches$ as unknown as Observable<readonly TMatch[]>,
    params$: match$.pipe(map((match) => match.params)),
    search$: match$.pipe(map((match) => match.search)),
    data$: match$.pipe(map((match) => match.data)),
    location$: router.location$.pipe(
      shareReplay({ bufferSize: 1, refCount: true }),
    ) as Observable<ParsedLocation<TMatch['search']>>,
    hash$: router.location$.pipe(map((location) => location.hash)),
    destroy$: lifecycle.destroy$,
    ...(parent ? { parent } : {}),
    child,
  };
};
