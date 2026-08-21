import { Subject } from "rxjs";
import type { Observable } from "rxjs";
import { hashQueryKeyByOptions, matchQuery } from "./utils";
import { Query } from "./query";
import type { QueryFilters } from "./utils";
import type { Action, QueryObserverLike, QueryState } from "./query";
import type {
  DefaultError,
  NotifyEvent,
  QueryKey,
  QueryOptions,
  WithRequired,
} from "./types";
import type { QueryClient } from "./queryClient";

// TYPES

export interface QueryCacheConfig {
  onError?: (
    error: DefaultError,
    query: Query<unknown, unknown, unknown>,
  ) => void;
  onSuccess?: (data: unknown, query: Query<unknown, unknown, unknown>) => void;
  onSettled?: (
    data: unknown | undefined,
    error: DefaultError | null,
    query: Query<unknown, unknown, unknown>,
  ) => void;
}

interface NotifyEventQueryAdded extends NotifyEvent {
  type: "added";
  query: Query<any, any, any, any>;
}

interface NotifyEventQueryRemoved extends NotifyEvent {
  type: "removed";
  query: Query<any, any, any, any>;
}

interface NotifyEventQueryUpdated extends NotifyEvent {
  type: "updated";
  query: Query<any, any, any, any>;
  action: Action<any, any>;
}

interface NotifyEventQueryObserverAdded extends NotifyEvent {
  type: "observerAdded";
  query: Query<any, any, any, any>;
  observer: QueryObserverLike;
}

interface NotifyEventQueryObserverRemoved extends NotifyEvent {
  type: "observerRemoved";
  query: Query<any, any, any, any>;
  observer: QueryObserverLike;
}

interface NotifyEventQueryObserverResultsUpdated extends NotifyEvent {
  type: "observerResultsUpdated";
  query: Query<any, any, any, any>;
}

export type QueryCacheNotifyEvent =
  | NotifyEventQueryAdded
  | NotifyEventQueryRemoved
  | NotifyEventQueryUpdated
  | NotifyEventQueryObserverAdded
  | NotifyEventQueryObserverRemoved
  | NotifyEventQueryObserverResultsUpdated;

// CLASS

export class QueryCache {
  #queries: Map<string, Query>;
  #events = new Subject<QueryCacheNotifyEvent>();

  /** Stream of every cache event: queries added/removed/updated, observers coming and going. */
  readonly events$: Observable<QueryCacheNotifyEvent> =
    this.#events.asObservable();

  constructor(public config: QueryCacheConfig = {}) {
    this.#queries = new Map<string, Query>();
  }

  build<
    TQueryFnData = unknown,
    TError = DefaultError,
    TData = TQueryFnData,
    TQueryKey extends QueryKey = QueryKey,
  >(
    client: QueryClient,
    options: WithRequired<
      QueryOptions<TQueryFnData, TError, TData, TQueryKey>,
      "queryKey"
    >,
    state?: QueryState<TData, TError>,
  ): Query<TQueryFnData, TError, TData, TQueryKey> {
    const queryKey = options.queryKey as TQueryKey;
    const queryHash =
      options.queryHash ?? hashQueryKeyByOptions(queryKey, options);
    let query = this.get<TQueryFnData, TError, TData, TQueryKey>(queryHash);

    if (!query) {
      query = new Query<TQueryFnData, TError, TData, TQueryKey>({
        client,
        queryKey,
        queryHash,
        options: client.defaultQueryOptions(options as any) as any,
        state,
        defaultOptions: client.getQueryDefaults(queryKey) as any,
      });
      this.add(query as unknown as Query);
    }

    return query;
  }

  add(query: Query<any, any, any, any>): void {
    if (!this.#queries.has(query.queryHash)) {
      this.#queries.set(query.queryHash, query);

      this.notify({
        type: "added",
        query,
      });
    }
  }

  remove(query: Query<any, any, any, any>): void {
    const queryInMap = this.#queries.get(query.queryHash);

    if (queryInMap) {
      query.destroy();

      if (queryInMap === query) {
        this.#queries.delete(query.queryHash);
      }

      this.notify({ type: "removed", query });
    }
  }

  clear(): void {
    this.getAll().forEach((query) => {
      this.remove(query);
    });
  }

  get<
    TQueryFnData = unknown,
    TError = DefaultError,
    TData = TQueryFnData,
    TQueryKey extends QueryKey = QueryKey,
  >(
    queryHash: string,
  ): Query<TQueryFnData, TError, TData, TQueryKey> | undefined {
    return this.#queries.get(queryHash) as
      Query<TQueryFnData, TError, TData, TQueryKey> | undefined;
  }

  getAll(): Array<Query> {
    return [...this.#queries.values()];
  }

  find<TQueryFnData = unknown, TError = DefaultError, TData = TQueryFnData>(
    filters: WithRequired<QueryFilters, "queryKey">,
  ): Query<TQueryFnData, TError, TData> | undefined {
    const defaultedFilters = { exact: true, ...filters };

    return this.getAll().find((query) =>
      matchQuery(defaultedFilters, query),
    ) as Query<TQueryFnData, TError, TData> | undefined;
  }

  findAll(filters: QueryFilters<any> = {}): Array<Query> {
    const queries = this.getAll();
    return Object.keys(filters).length > 0
      ? queries.filter((query) => matchQuery(filters, query))
      : queries;
  }

  notify(event: QueryCacheNotifyEvent): void {
    this.#events.next(event);
  }

  onFocus(): void {
    this.getAll().forEach((query) => {
      query.onFocus();
    });
  }

  onOnline(): void {
    this.getAll().forEach((query) => {
      query.onOnline();
    });
  }
}
