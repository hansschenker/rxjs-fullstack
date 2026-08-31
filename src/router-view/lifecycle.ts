import { Subject, Subscription, type Observable, type TeardownLogic } from 'rxjs';

/**
 * Route-level name for the Subscription-owned mount lifetime.
 *
 * The DOM renderer already treats Subscription as the lifetime owner. M14 gives
 * the same idea a router-view name so route components can receive destroy$ and
 * outlets can compose teardown explicitly.
 */
export interface RouteComponentLifecycle {
  readonly destroy$: Observable<void>;
  readonly subscription: Subscription;
  readonly add: (teardown: TeardownLogic) => void;
  readonly destroy: () => void;
}

export const createRouteComponentLifecycle = (): RouteComponentLifecycle => {
  const destroySubject = new Subject<void>();
  const subscription = new Subscription(() => {
    destroySubject.next();
    destroySubject.complete();
  });

  return {
    destroy$: destroySubject.asObservable(),
    subscription,
    add(teardown) {
      subscription.add(teardown);
    },
    destroy() {
      subscription.unsubscribe();
    },
  };
};
