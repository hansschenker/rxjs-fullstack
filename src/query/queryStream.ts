import {
  Observable,
  Subject,
  Subscription,
  interval,
  isObservable,
  timer,
} from "rxjs";
import { focusManager } from "./focusManager";
import { eager } from "./eager";
import {
  isServer,
  isValidTimeout,
  noop,
  replaceData,
  resolveQueryBoolean,
  resolveStaleTime,
  shallowEqualObjects,
  timeUntilStale,
} from "./utils";
import type {
  FetchOptions,
  Query,
  QueryObserverLike,
  QueryState,
} from "./query";
import type { QueryClient } from "./queryClient";
import type {
  DefaultError,
  DefaultedQueryStreamOptions,
  PlaceholderDataFunction,
  QueryKey,
  QueryResult,
  QueryStreamOptions,
  RefetchOptions,
} from "./types";

interface StreamFetchOptions extends FetchOptions {
  throwOnError?: boolean;
}

/**
 * Internal port of TanStack's `QueryObserver`: computes derived results from a
 * `Query` and drives mount/focus/reconnect/interval refetching. One instance
 * backs exactly one `query$` subscription.
 */
export class QueryStream<
  TQueryFnData = unknown,
  TError = DefaultError,
  TData = TQueryFnData,
  TQueryData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
> implements QueryObserverLike {
  options: DefaultedQueryStreamOptions<
    TQueryFnData,
    TError,
    TData,
    TQueryData,
    TQueryKey
  >;

  #client: QueryClient;
  #currentQuery: Query<TQueryFnData, TError, TQueryData, TQueryKey> =
    undefined!;
  #currentQueryInitialState: QueryState<TQueryData, TError> = undefined!;
  #currentResult: QueryResult<TData, TError> = undefined!;
  #currentResultState?: QueryState<TQueryData, TError>;
  #currentResultOptions?: QueryStreamOptions<
    TQueryFnData,
    TError,
    TData,
    TQueryData,
    TQueryKey
  >;
  #selectError: TError | null;
  #selectFn?: (data: TQueryData) => TData;
  #selectResult?: TData;
  // This property keeps track of the last query with defined data.
  // It will be used to pass the previous data and query to the placeholder
  // function between emissions.
  #lastQueryWithDefinedData?: Query<
    TQueryFnData,
    TError,
    TQueryData,
    TQueryKey
  >;
  #staleSub?: Subscription | undefined;
  #intervalSub?: Subscription | undefined;
  #currentRefetchInterval?: number | false;
  #subscribed = false;
  #results = new Subject<QueryResult<TData, TError>>();
  #refetch: (
    options?: RefetchOptions,
  ) => Observable<QueryResult<TData, TError>>;

  readonly results$: Observable<QueryResult<TData, TError>>;

  constructor(
    client: QueryClient,
    options: QueryStreamOptions<
      TQueryFnData,
      TError,
      TData,
      TQueryData,
      TQueryKey
    >,
  ) {
    this.#client = client;
    this.#selectError = null;
    this.results$ = this.#results.asObservable();
    this.#refetch = (refetchOptions) =>
      eager(() => this.fetch({ ...refetchOptions }));

    this.options = client.defaultQueryOptions(options);
    this.#assertValidEnabled();
    this.#updateQuery();
    this.#currentQuery.setOptions(this.options);
    this.updateResult();
  }

  #assertValidEnabled(): void {
    if (
      this.options.enabled !== undefined &&
      typeof this.options.enabled !== "boolean" &&
      typeof this.options.enabled !== "function"
    ) {
      throw new Error(
        "Expected enabled to be a boolean or a callback that returns a boolean",
      );
    }
  }

  onSubscribe(): void {
    this.#subscribed = true;
    this.#currentQuery.addObserver(this);

    if (shouldFetchOnMount(this.#currentQuery, this.options)) {
      this.#executeFetch();
    } else {
      this.updateResult();
    }

    this.#updateTimers();
  }

  destroy(): void {
    this.#subscribed = false;
    this.#clearStaleTimeout();
    this.#clearRefetchInterval();
    this.#currentQuery.removeObserver(this);
    this.#results.complete();
  }

  setOptions(
    options: QueryStreamOptions<
      TQueryFnData,
      TError,
      TData,
      TQueryData,
      TQueryKey
    >,
  ): void {
    const prevQuery = this.#currentQuery;
    const prevOptions = this.options;

    this.options = this.#client.defaultQueryOptions(options);
    this.#assertValidEnabled();

    this.#updateQuery();
    this.#currentQuery.setOptions(this.options);

    const mounted = this.#subscribed;

    // Fetch if there are subscribers
    if (
      mounted &&
      shouldFetchOptionally(
        this.#currentQuery,
        prevQuery,
        this.options,
        prevOptions,
      )
    ) {
      this.#executeFetch();
    }

    // Update result
    this.updateResult();

    // Update stale interval if needed
    if (
      mounted &&
      (this.#currentQuery !== prevQuery ||
        resolveQueryBoolean(this.options.enabled, this.#currentQuery) !==
          resolveQueryBoolean(prevOptions.enabled, this.#currentQuery) ||
        resolveStaleTime(this.options.staleTime, this.#currentQuery) !==
          resolveStaleTime(prevOptions.staleTime, this.#currentQuery))
    ) {
      this.#updateStaleTimeout();
    }

    const nextRefetchInterval = this.#computeRefetchInterval();

    // Update refetch interval if needed
    if (
      mounted &&
      (this.#currentQuery !== prevQuery ||
        resolveQueryBoolean(this.options.enabled, this.#currentQuery) !==
          resolveQueryBoolean(prevOptions.enabled, this.#currentQuery) ||
        nextRefetchInterval !== this.#currentRefetchInterval)
    ) {
      this.#updateRefetchInterval(nextRefetchInterval);
    }
  }

  getCurrentResult(): QueryResult<TData, TError> {
    return this.#currentResult;
  }

  getCurrentQuery(): Query<TQueryFnData, TError, TQueryData, TQueryKey> {
    return this.#currentQuery;
  }

  shouldFetchOnReconnect(): boolean {
    return shouldFetchOn(
      this.#currentQuery,
      this.options,
      this.options.refetchOnReconnect,
    );
  }

  shouldFetchOnWindowFocus(): boolean {
    return shouldFetchOn(
      this.#currentQuery,
      this.options,
      this.options.refetchOnWindowFocus,
    );
  }

  refetchForTrigger(): void {
    void this.fetch({ cancelRefetch: false });
  }

  onQueryUpdate(): void {
    this.updateResult();

    if (this.#subscribed) {
      this.#updateTimers();
    }
  }

  fetch(
    fetchOptions: StreamFetchOptions = {},
  ): Promise<QueryResult<TData, TError>> {
    return this.#executeFetch({
      ...fetchOptions,
      cancelRefetch: fetchOptions.cancelRefetch ?? true,
    }).then(() => {
      this.updateResult();
      return this.#currentResult;
    });
  }

  #executeFetch(
    fetchOptions?: Omit<StreamFetchOptions, "initialPromise">,
  ): Promise<TQueryData | undefined> {
    // Make sure we reference the latest query as the current one might have been removed
    this.#updateQuery();

    // Fetch
    let promise: Promise<TQueryData | undefined> = this.#currentQuery.fetch(
      this.options,
      fetchOptions,
    );

    if (!fetchOptions?.throwOnError) {
      promise = promise.catch(noop);
    }

    return promise;
  }

  #updateStaleTimeout(): void {
    this.#clearStaleTimeout();
    const staleTime = resolveStaleTime(
      this.options.staleTime,
      this.#currentQuery,
    );

    if (isServer || this.#currentResult.isStale || !isValidTimeout(staleTime)) {
      return;
    }

    const time = timeUntilStale(this.#currentResult.dataUpdatedAt, staleTime);

    // The timeout is sometimes triggered 1 ms before the stale time expiration.
    // To mitigate this issue we always add 1 ms to the timeout.
    this.#staleSub = timer(time + 1).subscribe(() => {
      if (!this.#currentResult.isStale) {
        this.updateResult();
      }
    });
  }

  #computeRefetchInterval() {
    return (
      (typeof this.options.refetchInterval === "function"
        ? this.options.refetchInterval(this.#currentQuery)
        : this.options.refetchInterval) ?? false
    );
  }

  #updateRefetchInterval(nextInterval: number | false): void {
    this.#clearRefetchInterval();

    this.#currentRefetchInterval = nextInterval;

    if (
      isServer ||
      resolveQueryBoolean(this.options.enabled, this.#currentQuery) === false ||
      !isValidTimeout(this.#currentRefetchInterval) ||
      this.#currentRefetchInterval === 0
    ) {
      return;
    }

    this.#intervalSub = interval(this.#currentRefetchInterval).subscribe(() => {
      if (
        this.options.refetchIntervalInBackground ||
        focusManager.isFocused()
      ) {
        this.#executeFetch();
      }
    });
  }

  #updateTimers(): void {
    this.#updateStaleTimeout();
    this.#updateRefetchInterval(this.#computeRefetchInterval());
  }

  #clearStaleTimeout(): void {
    this.#staleSub?.unsubscribe();
    this.#staleSub = undefined;
  }

  #clearRefetchInterval(): void {
    this.#intervalSub?.unsubscribe();
    this.#intervalSub = undefined;
  }

  protected createResult(
    query: Query<TQueryFnData, TError, TQueryData, TQueryKey>,
    options: QueryStreamOptions<
      TQueryFnData,
      TError,
      TData,
      TQueryData,
      TQueryKey
    >,
  ): QueryResult<TData, TError> {
    const prevQuery = this.#currentQuery;
    const prevResult = this.#currentResult as
      QueryResult<TData, TError> | undefined;
    const prevResultState = this.#currentResultState;
    const prevResultOptions = this.#currentResultOptions;
    const queryChange = query !== prevQuery;
    const queryInitialState = queryChange
      ? query.state
      : this.#currentQueryInitialState;

    const { state } = query;
    const newState = { ...state };
    let isPlaceholderData = false;
    let data: TData | undefined;

    let { error, errorUpdatedAt, status } = newState;

    // Per default, use query data
    data = newState.data as unknown as TData;
    let skipSelect = false;

    // use placeholderData if needed
    if (
      options.placeholderData !== undefined &&
      data === undefined &&
      status === "pending"
    ) {
      let placeholderData;

      // Memoize placeholder data
      if (
        prevResult?.isPlaceholderData &&
        options.placeholderData === prevResultOptions?.placeholderData
      ) {
        placeholderData = prevResult.data;
        // we have to skip select when reading this memoization
        // because prevResult.data is already "selected"
        skipSelect = true;
      } else {
        // compute placeholderData
        placeholderData =
          typeof options.placeholderData === "function"
            ? (
                options.placeholderData as unknown as PlaceholderDataFunction<TQueryData>
              )(
                this.#lastQueryWithDefinedData?.state.data,
                this.#lastQueryWithDefinedData as any,
              )
            : options.placeholderData;
      }

      if (placeholderData !== undefined) {
        status = "success";
        data = replaceData(
          prevResult?.data,
          placeholderData as unknown,
          options,
        ) as TData;
        isPlaceholderData = true;
      }
    }

    // Select data if needed
    // this also runs placeholderData through the select function
    if (options.select && data !== undefined && !skipSelect) {
      // Memoize select result
      if (
        prevResult &&
        data === prevResultState?.data &&
        options.select === this.#selectFn
      ) {
        data = this.#selectResult;
      } else {
        try {
          this.#selectFn = options.select;
          data = options.select(data as any);
          data = replaceData(prevResult?.data, data, options);
          this.#selectResult = data;
          this.#selectError = null;
        } catch (selectError) {
          this.#selectError = selectError as TError;
        }
      }
    } else if (data === undefined) {
      // a stored select error belongs to previously selected data; once that
      // data is gone (query switch or reset), it must not leak into this result
      this.#selectError = null;
    }

    if (this.#selectError) {
      error = this.#selectError;
      data = this.#selectResult;
      errorUpdatedAt = Date.now();
      status = "error";
      isPlaceholderData = false;
    }

    const isFetching = newState.fetchStatus === "fetching";
    const isPending = status === "pending";
    const isError = status === "error";

    const isLoading = isPending && isFetching;
    const hasData = data !== undefined;

    const result: QueryResult<TData, TError> = {
      status,
      fetchStatus: newState.fetchStatus,
      isPending,
      isSuccess: status === "success",
      isError,
      isLoading,
      data,
      dataUpdatedAt: newState.dataUpdatedAt,
      error,
      errorUpdatedAt,
      failureCount: newState.fetchFailureCount,
      failureReason: newState.fetchFailureReason,
      errorUpdateCount: newState.errorUpdateCount,
      isFetched: query.isFetched(),
      isFetchedAfterMount:
        newState.dataUpdateCount > queryInitialState.dataUpdateCount ||
        newState.errorUpdateCount > queryInitialState.errorUpdateCount,
      isFetching,
      isRefetching: isFetching && !isPending,
      isLoadingError: isError && !hasData,
      isPaused: newState.fetchStatus === "paused",
      isPlaceholderData,
      isRefetchError: isError && hasData,
      isStale: isStale(query, options),
      isEnabled: resolveQueryBoolean(options.enabled, query) !== false,
      refetch: this.#refetch,
    };

    return result;
  }

  updateResult(): void {
    const prevResult = this.#currentResult as
      QueryResult<TData, TError> | undefined;

    const nextResult = this.createResult(this.#currentQuery, this.options);

    this.#currentResultState = this.#currentQuery.state;
    this.#currentResultOptions = this.options;

    if (this.#currentResultState.data !== undefined) {
      this.#lastQueryWithDefinedData = this.#currentQuery;
    }

    // Only notify and update result if something has changed
    if (shallowEqualObjects(nextResult, prevResult)) {
      return;
    }

    this.#currentResult = nextResult;

    this.#results.next(nextResult);
    this.#client.queryCache.notify({
      query: this.#currentQuery as any,
      type: "observerResultsUpdated",
    });
  }

  #updateQuery(): void {
    const query = this.#client.queryCache.build(
      this.#client,
      this.options as any,
    ) as unknown as Query<TQueryFnData, TError, TQueryData, TQueryKey>;

    if (query === this.#currentQuery) {
      return;
    }

    const prevQuery = this.#currentQuery as
      Query<TQueryFnData, TError, TQueryData, TQueryKey> | undefined;
    this.#currentQuery = query;
    this.#currentQueryInitialState = query.state;

    if (this.#subscribed) {
      prevQuery?.removeObserver(this);
      query.addObserver(this);
    }
  }
}

// HELPERS (ported from queryObserver.ts)

function shouldLoadOnMount(
  query: Query<any, any, any, any>,
  options: QueryStreamOptions<any, any, any, any, any>,
): boolean {
  return (
    resolveQueryBoolean(options.enabled, query) !== false &&
    query.state.data === undefined &&
    !(
      query.state.status === "error" &&
      resolveQueryBoolean(options.retryOnMount, query) === false
    )
  );
}

function shouldFetchOnMount(
  query: Query<any, any, any, any>,
  options: QueryStreamOptions<any, any, any, any, any>,
): boolean {
  return (
    shouldLoadOnMount(query, options) ||
    (query.state.data !== undefined &&
      shouldFetchOn(query, options, options.refetchOnMount))
  );
}

function shouldFetchOn(
  query: Query<any, any, any, any>,
  options: QueryStreamOptions<any, any, any, any, any>,
  field: QueryStreamOptions<any, any, any, any, any>["refetchOnMount"],
) {
  if (
    resolveQueryBoolean(options.enabled, query) !== false &&
    resolveStaleTime(options.staleTime, query) !== "static"
  ) {
    const value = typeof field === "function" ? field(query) : field;

    return value === "always" || (value !== false && isStale(query, options));
  }
  return false;
}

function shouldFetchOptionally(
  query: Query<any, any, any, any>,
  prevQuery: Query<any, any, any, any>,
  options: QueryStreamOptions<any, any, any, any, any>,
  prevOptions: QueryStreamOptions<any, any, any, any, any>,
): boolean {
  return (
    (query !== prevQuery ||
      resolveQueryBoolean(prevOptions.enabled, query) === false) &&
    isStale(query, options)
  );
}

function isStale(
  query: Query<any, any, any, any>,
  options: QueryStreamOptions<any, any, any, any, any>,
): boolean {
  return (
    resolveQueryBoolean(options.enabled, query) !== false &&
    query.isStaleByTime(resolveStaleTime(options.staleTime, query))
  );
}

// PUBLIC FACTORY

/** What a stream implementation must provide to be wrapped as an Observable. */
export interface StreamLike<TOptions, TResult> {
  results$: Observable<TResult>;
  setOptions(options: TOptions): void;
  onSubscribe(): void;
  destroy(): void;
  getCurrentResult(): TResult;
}

/**
 * Wraps a stream implementation (QueryStream, InfiniteQueryStream, …) into a
 * cold Observable that mounts on subscribe and tears down on unsubscribe.
 * Accepts a static options object or an `Observable` of options — pushing new
 * options into an active subscription behaves like TanStack's `setOptions`.
 */
export function createStreamObservable<TOptions, TResult>(
  client: QueryClient,
  optionsInput: TOptions | Observable<TOptions>,
  construct: (options: TOptions) => StreamLike<TOptions, TResult>,
): Observable<TResult> {
  return new Observable<TResult>((subscriber) => {
    const sub = new Subscription();
    let stream: StreamLike<TOptions, TResult> | undefined;
    let emitted = false;

    client.retainStreams();
    sub.add(() => client.releaseStreams());

    const handleOptions = (options: TOptions) => {
      if (stream) {
        stream.setOptions(options);
        return;
      }

      try {
        stream = construct(options);
      } catch (error) {
        subscriber.error(error);
        return;
      }
      const activeStream = stream;
      sub.add(() => activeStream.destroy());
      sub.add(
        activeStream.results$.subscribe((result) => {
          emitted = true;
          subscriber.next(result);
        }),
      );
      activeStream.onSubscribe();
      if (!emitted) {
        subscriber.next(activeStream.getCurrentResult());
      }
    };

    if (isObservable(optionsInput)) {
      sub.add(
        optionsInput.subscribe({
          next: handleOptions,
          error: (error) => subscriber.error(error),
          // an options stream completing keeps the query stream alive
        }),
      );
    } else {
      handleOptions(optionsInput);
    }

    return sub;
  });
}

/**
 * Creates the `Observable<QueryResult>` behind `client.query$()`.
 *
 * Accepts either a static options object or an `Observable` of options —
 * pushing new options into an active subscription behaves like TanStack's
 * `setOptions` (e.g. changing the `queryKey` switches queries while
 * `placeholderData: keepPreviousData` keeps showing the old data).
 */
export function createQueryStream<
  TQueryFnData = unknown,
  TError = DefaultError,
  TData = TQueryFnData,
  TQueryData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
>(
  client: QueryClient,
  optionsInput:
    | QueryStreamOptions<TQueryFnData, TError, TData, TQueryData, TQueryKey>
    | Observable<
        QueryStreamOptions<TQueryFnData, TError, TData, TQueryData, TQueryKey>
      >,
): Observable<QueryResult<TData, TError>> {
  return createStreamObservable(
    client,
    optionsInput,
    (options) => new QueryStream(client, options),
  );
}
