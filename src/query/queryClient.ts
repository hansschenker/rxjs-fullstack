import { defer, distinctUntilChanged, map, startWith } from "rxjs";
import type { Observable, Subscription } from "rxjs";
import {
  functionalUpdate,
  hashKey,
  hashQueryKeyByOptions,
  noop,
  partialMatchKey,
  resolveStaleTime,
  skipToken,
} from "./utils";
import { QueryCache } from "./queryCache";
import { MutationCache } from "./mutationCache";
import { focusManager } from "./focusManager";
import { onlineManager } from "./onlineManager";
import { eager } from "./eager";
import { createQueryStream } from "./queryStream";
import { createInfiniteQueryStream } from "./infiniteQueryStream";
import { createQueriesStream } from "./queriesStream";
import { MutationStream } from "./mutationStream";
import type { InfiniteQueryResult } from "./infiniteQueryStream";
import type { QueriesResults, QueriesStreamOptions } from "./queriesStream";
import type {
  MutationFilters,
  QueryFilters,
  QueryTypeFilter,
  Updater,
} from "./utils";
import type { QueryState } from "./query";
import type {
  CancelOptions,
  DefaultError,
  DefaultOptions,
  DefaultedQueryStreamOptions,
  EnsureQueryDataOptions,
  FetchInfiniteQueryOptions,
  FetchQueryOptions,
  InfiniteData,
  InfiniteQueryStreamOptions,
  InvalidateOptions,
  MutationKey,
  MutationOptions,
  OmitKeyof,
  QueryClientConfig,
  QueryKey,
  QueryResult,
  QueryStreamOptions,
  RefetchOptions,
  ResetOptions,
  SetDataOptions,
} from "./types";

// TYPES

export interface InvalidateQueryFilters<
  TQueryKey extends QueryKey = QueryKey,
> extends QueryFilters<TQueryKey> {
  refetchType?: QueryTypeFilter | "none";
}

export type RefetchQueryFilters<TQueryKey extends QueryKey = QueryKey> =
  QueryFilters<TQueryKey>;

interface QueryDefaults {
  queryKey: QueryKey;
  defaultOptions: OmitKeyof<QueryStreamOptions<any, any, any, any>, "queryKey">;
}

interface MutationDefaults {
  mutationKey: MutationKey;
  defaultOptions: MutationOptions<any, any, any, any>;
}

// CLASS

export class QueryClient {
  readonly queryCache: QueryCache;
  readonly mutationCache: MutationCache;
  #defaultOptions: DefaultOptions;
  #queryDefaults: Map<string, QueryDefaults>;
  #mutationDefaults: Map<string, MutationDefaults>;
  #mountCount: number;
  #focusSub?: Subscription | undefined;
  #onlineSub?: Subscription | undefined;

  constructor(config: QueryClientConfig = {}) {
    this.queryCache = config.queryCache || new QueryCache();
    this.mutationCache = config.mutationCache || new MutationCache();
    this.#defaultOptions = config.defaultOptions || {};
    this.#queryDefaults = new Map();
    this.#mutationDefaults = new Map();
    this.#mountCount = 0;
  }

  /**
   * The reactive surface: an Observable of query results. Subscribing mounts
   * the query (fetching it when stale), keeps it updated through refetch
   * triggers (focus, reconnect, intervals, invalidation), and releases it on
   * unsubscribe. Pass an `Observable` of options to switch queries in-flight
   * (e.g. a changing `queryKey` with `placeholderData: keepPreviousData`).
   */
  query$<
    TQueryFnData = unknown,
    TError = DefaultError,
    TData = TQueryFnData,
    TQueryKey extends QueryKey = QueryKey,
  >(
    options:
      | QueryStreamOptions<TQueryFnData, TError, TData, TQueryFnData, TQueryKey>
      | Observable<
          QueryStreamOptions<
            TQueryFnData,
            TError,
            TData,
            TQueryFnData,
            TQueryKey
          >
        >,
  ): Observable<QueryResult<TData, TError>> {
    return createQueryStream(this, options);
  }

  /**
   * Observable of infinite-query results; emitted results carry
   * `fetchNextPage()`/`fetchPreviousPage()` controls.
   */
  infiniteQuery$<
    TQueryFnData = unknown,
    TError = DefaultError,
    TData = InfiniteData<TQueryFnData>,
    TQueryKey extends QueryKey = QueryKey,
    TPageParam = unknown,
  >(
    options:
      | InfiniteQueryStreamOptions<
          TQueryFnData,
          TError,
          TData,
          TQueryKey,
          TPageParam
        >
      | Observable<
          InfiniteQueryStreamOptions<
            TQueryFnData,
            TError,
            TData,
            TQueryKey,
            TPageParam
          >
        >,
  ): Observable<InfiniteQueryResult<TData, TError>> {
    return createInfiniteQueryStream(this, options);
  }

  /**
   * Observes a list of queries as one stream — the `QueriesObserver`
   * equivalent. Pass `combine` to project the result array; the combined
   * value is memoized with structural sharing.
   */
  queries$<TCombinedResult = QueriesResults>(
    queries:
      | Array<QueryStreamOptions<any, any, any, any, any>>
      | Observable<Array<QueryStreamOptions<any, any, any, any, any>>>,
    options?: QueriesStreamOptions<TCombinedResult>,
  ): Observable<TCombinedResult> {
    return createQueriesStream(this, queries, options);
  }

  /**
   * Creates a mutation handle with `state$` (current result, then updates)
   * and cold `mutate$(variables)` — each subscription runs the mutation once.
   */
  mutation<
    TData = unknown,
    TError = DefaultError,
    TVariables = void,
    TOnMutateResult = unknown,
  >(
    options: MutationOptions<TData, TError, TVariables, TOnMutateResult>,
  ): MutationStream<TData, TError, TVariables, TOnMutateResult> {
    return new MutationStream(this, options);
  }

  /**
   * Focus/online refetch triggers are attached automatically while at least
   * one `query$` subscription is active. `mount()`/`unmount()` allow keeping
   * them attached manually (e.g. for an app that only uses `fetchQuery`).
   */
  mount(): void {
    this.retainStreams();
  }

  unmount(): void {
    this.releaseStreams();
  }

  /** @internal */
  retainStreams(): void {
    this.#mountCount++;
    if (this.#mountCount !== 1) return;

    this.#focusSub = focusManager.focused$.subscribe((focused) => {
      if (focused) {
        void this.#resumePausedMutations()
          .catch(noop)
          .then(() => this.queryCache.onFocus());
      }
    });
    this.#onlineSub = onlineManager.online$.subscribe((online) => {
      if (online) {
        void this.#resumePausedMutations()
          .catch(noop)
          .then(() => this.queryCache.onOnline());
      }
    });
  }

  /** @internal */
  releaseStreams(): void {
    this.#mountCount--;
    if (this.#mountCount !== 0) return;

    this.#focusSub?.unsubscribe();
    this.#focusSub = undefined;

    this.#onlineSub?.unsubscribe();
    this.#onlineSub = undefined;
  }

  isFetching(filters?: QueryFilters): number {
    return this.queryCache.findAll({ ...filters, fetchStatus: "fetching" })
      .length;
  }

  /** Live count of currently fetching queries matching `filters`. */
  isFetching$(filters?: QueryFilters): Observable<number> {
    return defer(() =>
      this.queryCache.events$.pipe(
        map(() => this.isFetching(filters)),
        startWith(this.isFetching(filters)),
        distinctUntilChanged(),
      ),
    );
  }

  isMutating(filters?: MutationFilters): number {
    return this.mutationCache.findAll({ ...filters, status: "pending" }).length;
  }

  /** Live count of currently pending mutations matching `filters`. */
  isMutating$(filters?: MutationFilters): Observable<number> {
    return defer(() =>
      this.mutationCache.events$.pipe(
        map(() => this.isMutating(filters)),
        startWith(this.isMutating(filters)),
        distinctUntilChanged(),
      ),
    );
  }

  /**
   * Imperative (non-reactive) way to retrieve data for a QueryKey.
   * Should only be used in callbacks or functions where reading the latest
   * data is necessary, e.g. for optimistic updates.
   */
  getQueryData<TQueryFnData = unknown>(
    queryKey: QueryKey,
  ): TQueryFnData | undefined {
    const options = this.defaultQueryOptions({ queryKey });

    return this.queryCache.get<TQueryFnData>(options.queryHash)?.state.data;
  }

  getQueriesData<TQueryFnData = unknown>(
    filters: QueryFilters,
  ): Array<[QueryKey, TQueryFnData | undefined]> {
    return this.queryCache.findAll(filters).map(({ queryKey, state }) => {
      const data = state.data as TQueryFnData | undefined;
      return [queryKey, data];
    });
  }

  setQueryData<TQueryFnData = unknown>(
    queryKey: QueryKey,
    updater: Updater<TQueryFnData | undefined, TQueryFnData | undefined>,
    options?: SetDataOptions,
  ): TQueryFnData | undefined {
    const defaultedOptions = this.defaultQueryOptions({ queryKey });

    const query = this.queryCache.get<TQueryFnData>(defaultedOptions.queryHash);
    const prevData = query?.state.data;
    const data = functionalUpdate(updater, prevData);

    if (data === undefined) {
      return undefined;
    }

    return this.queryCache
      .build(this, defaultedOptions as any)
      .setData(data, { ...options, manual: true }) as TQueryFnData;
  }

  setQueriesData<TQueryFnData = unknown>(
    filters: QueryFilters,
    updater: Updater<TQueryFnData | undefined, TQueryFnData | undefined>,
    options?: SetDataOptions,
  ): Array<[QueryKey, TQueryFnData | undefined]> {
    return this.queryCache
      .findAll(filters)
      .map(({ queryKey }) => [
        queryKey,
        this.setQueryData<TQueryFnData>(queryKey, updater, options),
      ]);
  }

  getQueryState<TQueryFnData = unknown, TError = DefaultError>(
    queryKey: QueryKey,
  ): QueryState<TQueryFnData, TError> | undefined {
    const options = this.defaultQueryOptions({ queryKey });
    return this.queryCache.get<TQueryFnData, TError>(options.queryHash)?.state;
  }

  removeQueries(filters?: QueryFilters): void {
    const queryCache = this.queryCache;
    queryCache.findAll(filters).forEach((query) => {
      queryCache.remove(query);
    });
  }

  /** Eager: resets matching queries to their initial state and refetches active ones. */
  resetQueries(
    filters?: QueryFilters,
    options?: ResetOptions,
  ): Observable<void> {
    return eager(() => {
      const queryCache = this.queryCache;
      const matched = queryCache.findAll(filters);
      const queriesToRefetch = new Set(matched);
      matched.forEach((query) => {
        query.reset();
      });
      return this.#refetchQueries(
        {
          type: "active",
          predicate: (query) => queriesToRefetch.has(query),
        },
        options,
      );
    });
  }

  /** Eager: cancels in-flight fetches for matching queries. */
  cancelQueries(
    filters?: QueryFilters,
    cancelOptions: CancelOptions = {},
  ): Observable<void> {
    return eager(() => {
      const defaultedCancelOptions = { revert: true, ...cancelOptions };

      const promises = this.queryCache
        .findAll(filters)
        .map((query) => query.cancel(defaultedCancelOptions));

      return Promise.all(promises).then(noop).catch(noop);
    });
  }

  /**
   * Eager: marks matching queries stale and refetches the active ones.
   * The work starts immediately; subscribe (or `firstValueFrom`) to await it.
   */
  invalidateQueries(
    filters?: InvalidateQueryFilters,
    options: InvalidateOptions = {},
  ): Observable<void> {
    return eager(() => {
      this.queryCache.findAll(filters).forEach((query) => {
        query.invalidate();
      });

      if (filters?.refetchType === "none") {
        return Promise.resolve();
      }
      return this.#refetchQueries(
        {
          ...filters,
          type: filters?.refetchType ?? filters?.type ?? "active",
        },
        options,
      );
    });
  }

  /** Eager: refetches matching queries regardless of staleness. */
  refetchQueries(
    filters?: RefetchQueryFilters,
    options?: RefetchOptions,
  ): Observable<void> {
    return eager(() => this.#refetchQueries(filters, options));
  }

  #refetchQueries(
    filters?: RefetchQueryFilters,
    options: RefetchOptions = {},
  ): Promise<void> {
    const fetchOptions = {
      ...options,
      cancelRefetch: options.cancelRefetch ?? true,
    };
    const promises = this.queryCache
      .findAll(filters)
      .filter((query) => !query.isDisabled() && !query.isStatic())
      .map((query) => {
        let promise: Promise<unknown> = query.fetch(undefined, fetchOptions);
        if (!fetchOptions.throwOnError) {
          promise = promise.catch(noop);
        }
        return query.state.fetchStatus === "paused"
          ? Promise.resolve()
          : promise;
      });

    return Promise.all(promises).then(noop);
  }

  /**
   * Eager: fetches (or reads fresh cached data for) a query and replays the
   * result. Errors surface on the observable's error channel.
   */
  fetchQuery<
    TQueryFnData,
    TError = DefaultError,
    TData = TQueryFnData,
    TQueryKey extends QueryKey = QueryKey,
  >(
    options: FetchQueryOptions<TQueryFnData, TError, TData, TQueryKey>,
  ): Observable<TData> {
    return eager(() => this.#fetchQuery(options));
  }

  #fetchQuery<
    TQueryFnData,
    TError = DefaultError,
    TData = TQueryFnData,
    TQueryKey extends QueryKey = QueryKey,
  >(
    options: FetchQueryOptions<TQueryFnData, TError, TData, TQueryKey>,
  ): Promise<TData> {
    const defaultedOptions = this.defaultQueryOptions(
      options as QueryStreamOptions<any, any, any, any, any>,
    );

    // https://github.com/tannerlinsley/react-query/issues/652
    if (defaultedOptions.retry === undefined) {
      defaultedOptions.retry = false;
    }

    const query = this.queryCache.build(this, defaultedOptions as any);

    return query.isStaleByTime(
      resolveStaleTime(defaultedOptions.staleTime, query as any),
    )
      ? (query.fetch(defaultedOptions as any) as Promise<TData>)
      : Promise.resolve(query.state.data as TData);
  }

  /** Eager: like `fetchQuery`, but swallows errors. Completes without emitting a value. */
  prefetchQuery<
    TQueryFnData = unknown,
    TError = DefaultError,
    TData = TQueryFnData,
    TQueryKey extends QueryKey = QueryKey,
  >(
    options: FetchQueryOptions<TQueryFnData, TError, TData, TQueryKey>,
  ): Observable<void> {
    return eager(() => this.#fetchQuery(options).then(noop).catch(noop));
  }

  /** Eager: returns cached data when present, fetches otherwise. */
  ensureQueryData<
    TQueryFnData,
    TError = DefaultError,
    TData = TQueryFnData,
    TQueryKey extends QueryKey = QueryKey,
  >(
    options: EnsureQueryDataOptions<TQueryFnData, TError, TData, TQueryKey>,
  ): Observable<TData> {
    return eager(() => {
      const defaultedOptions = this.defaultQueryOptions(
        options as QueryStreamOptions<any, any, any, any, any>,
      );
      const query = this.queryCache.build(this, defaultedOptions as any);
      const cachedData = query.state.data as TData | undefined;

      if (cachedData === undefined) {
        return this.#fetchQuery(options);
      }

      if (
        options.revalidateIfStale &&
        query.isStaleByTime(
          resolveStaleTime(defaultedOptions.staleTime, query as any),
        )
      ) {
        void this.#fetchQuery(options).then(noop).catch(noop);
      }

      return Promise.resolve(cachedData);
    });
  }

  /** Eager: like `fetchQuery` for infinite queries; prefetches `pages` pages. */
  fetchInfiniteQuery<
    TQueryFnData,
    TError = DefaultError,
    TData = TQueryFnData,
    TQueryKey extends QueryKey = QueryKey,
    TPageParam = unknown,
  >(
    options: FetchInfiniteQueryOptions<
      TQueryFnData,
      TError,
      TData,
      TQueryKey,
      TPageParam
    >,
  ): Observable<InfiniteData<TData, TPageParam>> {
    options._type = "infinite";
    return eager(() =>
      this.#fetchQuery(options as unknown as FetchQueryOptions<any, any, any>),
    ) as Observable<InfiniteData<TData, TPageParam>>;
  }

  /** Eager: like `prefetchQuery` for infinite queries; swallows errors. */
  prefetchInfiniteQuery<
    TQueryFnData,
    TError = DefaultError,
    TData = TQueryFnData,
    TQueryKey extends QueryKey = QueryKey,
    TPageParam = unknown,
  >(
    options: FetchInfiniteQueryOptions<
      TQueryFnData,
      TError,
      TData,
      TQueryKey,
      TPageParam
    >,
  ): Observable<void> {
    options._type = "infinite";
    return eager(() =>
      this.#fetchQuery(options as unknown as FetchQueryOptions<any, any, any>)
        .then(noop)
        .catch(noop),
    );
  }

  /**
   * Eager: resumes mutations that were paused (e.g. while offline). Also runs
   * automatically on focus/reconnect while the client is mounted.
   */
  resumePausedMutations(): Observable<unknown> {
    return eager(() => this.#resumePausedMutations());
  }

  #resumePausedMutations(): Promise<unknown> {
    if (onlineManager.isOnline()) {
      return this.mutationCache.resumePausedMutations();
    }
    return Promise.resolve();
  }

  getQueryCache(): QueryCache {
    return this.queryCache;
  }

  getMutationCache(): MutationCache {
    return this.mutationCache;
  }

  setMutationDefaults<
    TData = unknown,
    TError = DefaultError,
    TVariables = void,
    TOnMutateResult = unknown,
  >(
    mutationKey: MutationKey,
    options: OmitKeyof<
      MutationOptions<TData, TError, TVariables, TOnMutateResult>,
      "mutationKey"
    >,
  ): void {
    this.#mutationDefaults.set(hashKey(mutationKey), {
      mutationKey,
      defaultOptions: options,
    });
  }

  getMutationDefaults(
    mutationKey: MutationKey,
  ): OmitKeyof<MutationOptions<any, any, any, any>, "mutationKey"> {
    const defaults = [...this.#mutationDefaults.values()];

    const result: OmitKeyof<
      MutationOptions<any, any, any, any>,
      "mutationKey"
    > = {};

    defaults.forEach((mutationDefault) => {
      if (partialMatchKey(mutationKey, mutationDefault.mutationKey)) {
        Object.assign(result, mutationDefault.defaultOptions);
      }
    });

    return result;
  }

  defaultMutationOptions<T extends MutationOptions<any, any, any, any>>(
    options?: T,
  ): T {
    if (options?._defaulted) {
      return options;
    }
    return {
      ...this.#defaultOptions.mutations,
      ...(options?.mutationKey &&
        this.getMutationDefaults(options.mutationKey)),
      ...options,
      _defaulted: true,
    } as T;
  }

  getDefaultOptions(): DefaultOptions {
    return this.#defaultOptions;
  }

  setDefaultOptions(options: DefaultOptions): void {
    this.#defaultOptions = options;
  }

  setQueryDefaults(
    queryKey: QueryKey,
    options: Partial<
      OmitKeyof<QueryStreamOptions<any, any, any, any>, "queryKey">
    >,
  ): void {
    this.#queryDefaults.set(hashKey(queryKey), {
      queryKey,
      defaultOptions: options,
    });
  }

  getQueryDefaults(
    queryKey: QueryKey,
  ): OmitKeyof<QueryStreamOptions<any, any, any, any, any>, "queryKey"> {
    const defaults = [...this.#queryDefaults.values()];

    const result: OmitKeyof<
      QueryStreamOptions<any, any, any, any, any>,
      "queryKey"
    > = {};

    defaults.forEach((queryDefault) => {
      if (partialMatchKey(queryKey, queryDefault.queryKey)) {
        Object.assign(result, queryDefault.defaultOptions);
      }
    });
    return result;
  }

  defaultQueryOptions<
    TQueryFnData = unknown,
    TError = DefaultError,
    TData = TQueryFnData,
    TQueryData = TQueryFnData,
    TQueryKey extends QueryKey = QueryKey,
  >(
    options:
      | QueryStreamOptions<TQueryFnData, TError, TData, TQueryData, TQueryKey>
      | DefaultedQueryStreamOptions<
          TQueryFnData,
          TError,
          TData,
          TQueryData,
          TQueryKey
        >,
  ): DefaultedQueryStreamOptions<
    TQueryFnData,
    TError,
    TData,
    TQueryData,
    TQueryKey
  > {
    if (options._defaulted) {
      return options as DefaultedQueryStreamOptions<
        TQueryFnData,
        TError,
        TData,
        TQueryData,
        TQueryKey
      >;
    }

    const defaultedOptions = {
      ...this.#defaultOptions.queries,
      ...this.getQueryDefaults(options.queryKey as QueryKey),
      ...options,
      _defaulted: true,
    };

    if (!defaultedOptions.queryHash) {
      defaultedOptions.queryHash = hashQueryKeyByOptions(
        defaultedOptions.queryKey as QueryKey,
        defaultedOptions,
      );
    }

    // dependent default values
    if (defaultedOptions.refetchOnReconnect === undefined) {
      defaultedOptions.refetchOnReconnect =
        defaultedOptions.networkMode !== "always";
    }

    if (defaultedOptions.queryFn === skipToken) {
      defaultedOptions.enabled = false;
    }

    return defaultedOptions as DefaultedQueryStreamOptions<
      TQueryFnData,
      TError,
      TData,
      TQueryData,
      TQueryKey
    >;
  }

  clear(): void {
    this.queryCache.clear();
    this.mutationCache.clear();
  }
}
