import {
  Subject,
  concat,
  defer,
  filter,
  from,
  ignoreElements,
  map,
  merge,
  mergeMap,
  of,
  retry,
  take,
  tap,
  throwError,
  timer,
} from "rxjs";
import type { Observable, Subscription } from "rxjs";
import { focusManager } from "./focusManager";
import { onlineManager } from "./onlineManager";
import { isServer, noop } from "./utils";
import type {
  CancelOptions,
  DefaultError,
  NetworkMode,
  RetryDelayValue,
  RetryValue,
} from "./types";

// TYPES

interface RetryerConfig<TData = unknown, TError = DefaultError> {
  fn: () => TData | Promise<TData>;
  initialPromise?: Promise<TData> | undefined;
  onCancel?: (error: TError) => void;
  onFail?: (failureCount: number, error: TError) => void;
  onPause?: () => void;
  onContinue?: () => void;
  retry?: RetryValue<TError> | undefined;
  retryDelay?: RetryDelayValue<TError> | undefined;
  networkMode: NetworkMode | undefined;
  canRun: () => boolean;
}

export interface Retryer<TData = unknown> {
  promise: Promise<TData>;
  cancel: (cancelOptions?: CancelOptions) => void;
  continue: () => Promise<unknown>;
  cancelRetry: () => void;
  continueRetry: () => void;
  canStart: () => boolean;
  start: () => Promise<TData>;
  status: () => RetryerStatus;
}

type RetryerStatus = "pending" | "resolved" | "rejected";

function defaultRetryDelay(failureCount: number) {
  return Math.min(1000 * 2 ** failureCount, 30000);
}

export function canFetch(networkMode: NetworkMode | undefined): boolean {
  return (networkMode ?? "online") === "online"
    ? onlineManager.isOnline()
    : true;
}

export class CancelledError extends Error {
  revert?: boolean | undefined;
  silent?: boolean | undefined;
  constructor(options?: CancelOptions) {
    super("CancelledError");
    this.revert = options?.revert;
    this.silent = options?.silent;
  }
}

/**
 * Executes `config.fn` with retry/backoff, pausing while offline or
 * unfocused (depending on `networkMode`). The retry loop is an RxJS pipeline;
 * the promise seam is what `Query.fetch` consumes.
 *
 * Unlike TanStack's retryer, a paused retryer resumes on `focused$`/`online$`
 * emissions by itself — no client-level `continue()` wiring is required
 * (though `continue()` still works).
 */
export function createRetryer<TData = unknown, TError = DefaultError>(
  config: RetryerConfig<TData, TError>,
): Retryer<TData> {
  let isRetryCancelled = false;
  let failureCount = 0;
  let status: RetryerStatus = "pending";
  let subscription: Subscription | undefined;
  const manualContinue$ = new Subject<void>();

  let promiseResolve!: (data: TData) => void;
  let promiseReject!: (error: unknown) => void;
  const promise = new Promise<TData>((resolve, reject) => {
    promiseResolve = resolve;
    promiseReject = reject;
  });
  promise.catch(noop);

  const canContinue = () =>
    focusManager.isFocused() &&
    (config.networkMode === "always" || onlineManager.isOnline()) &&
    config.canRun();

  const canStart = () => canFetch(config.networkMode) && config.canRun();

  const resolveOnce = (value: TData) => {
    if (status === "pending") {
      status = "resolved";
      promiseResolve(value);
    }
  };

  const rejectOnce = (error: unknown) => {
    if (status === "pending") {
      status = "rejected";
      promiseReject(error);
    }
  };

  /** Emits once (and calls onPause/onContinue) when fetching may resume. */
  const pause$: Observable<void> = defer(() => {
    config.onPause?.();
    return merge(
      manualContinue$,
      focusManager.focused$,
      onlineManager.online$,
    ).pipe(
      filter(() => canContinue()),
      take(1),
      tap(() => config.onContinue?.()),
      map(() => undefined),
    );
  });

  const attempt$: Observable<TData> = defer(() => {
    // we can re-use config.initialPromise on the first attempt
    const initialPromise =
      failureCount === 0 ? config.initialPromise : undefined;
    if (initialPromise) {
      return from(initialPromise);
    }
    try {
      return from(Promise.resolve(config.fn()));
    } catch (error) {
      return throwError(() => error);
    }
  });

  const run$ = attempt$.pipe(
    retry({
      delay: (error) => {
        const retryValue = config.retry ?? (isServer ? 0 : 3);
        const retryDelay = config.retryDelay ?? defaultRetryDelay;
        const delay =
          typeof retryDelay === "function"
            ? retryDelay(failureCount, error)
            : retryDelay;
        const shouldRetry =
          retryValue === true ||
          (typeof retryValue === "number" && failureCount < retryValue) ||
          (typeof retryValue === "function" && retryValue(failureCount, error));

        if (isRetryCancelled || !shouldRetry) {
          return throwError(() => error);
        }

        failureCount++;
        config.onFail?.(failureCount, error);

        return timer(delay).pipe(
          // Pause if the document is not visible or the device is offline
          mergeMap(() => (canContinue() ? of(undefined) : pause$)),
          mergeMap(() =>
            isRetryCancelled ? throwError(() => error) : of(undefined),
          ),
        );
      },
    }),
  );

  const gated$ = defer(() =>
    canStart() ? run$ : concat(pause$.pipe(ignoreElements()), run$),
  );

  return {
    promise,
    status: () => status,
    cancel: (cancelOptions?: CancelOptions): void => {
      if (status === "pending") {
        const error = new CancelledError(cancelOptions);
        rejectOnce(error);
        config.onCancel?.(error as TError);
        subscription?.unsubscribe();
      }
    },
    continue: () => {
      manualContinue$.next();
      return promise;
    },
    cancelRetry: () => {
      isRetryCancelled = true;
    },
    continueRetry: () => {
      isRetryCancelled = false;
    },
    canStart,
    start: () => {
      subscription = gated$.subscribe({
        next: resolveOnce,
        error: rejectOnce,
      });
      return promise;
    },
  };
}
