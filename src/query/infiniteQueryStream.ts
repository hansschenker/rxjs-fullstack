import { QueryStream, createStreamObservable } from "./queryStream";
import { hasNextPage, hasPreviousPage } from "./infiniteQueryBehavior";
import { eager } from "./eager";
import type { Observable } from "rxjs";
import type { Query } from "./query";
import type { QueryClient } from "./queryClient";
import type {
  DefaultError,
  FetchNextPageOptions,
  FetchPreviousPageOptions,
  InfiniteData,
  InfiniteQueryPageParamsOptions,
  InfiniteQueryStreamOptions,
  QueryKey,
  QueryResult,
  QueryStreamOptions,
} from "./types";

// TYPES

export interface InfiniteQueryResult<
  TData = unknown,
  TError = DefaultError,
> extends QueryResult<TData, TError> {
  /** Eagerly fetches the next page; the observable replays the settled result. */
  fetchNextPage: (
    options?: FetchNextPageOptions,
  ) => Observable<InfiniteQueryResult<TData, TError>>;
  /** Eagerly fetches the previous page; the observable replays the settled result. */
  fetchPreviousPage: (
    options?: FetchPreviousPageOptions,
  ) => Observable<InfiniteQueryResult<TData, TError>>;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  isFetchNextPageError: boolean;
  isFetchingNextPage: boolean;
  isFetchPreviousPageError: boolean;
  isFetchingPreviousPage: boolean;
}

interface BoundPageFns<TData, TError> {
  fetchNextPage: (
    options?: FetchNextPageOptions,
  ) => Observable<InfiniteQueryResult<TData, TError>>;
  fetchPreviousPage: (
    options?: FetchPreviousPageOptions,
  ) => Observable<InfiniteQueryResult<TData, TError>>;
}

// Bound page functions must be identity-stable across results (for emission
// deduplication) and available while the base constructor runs — before this
// subclass's private brand is attached — hence a WeakMap + module function
// instead of a field or private method.
const boundPageFns = new WeakMap<
  InfiniteQueryStream<any, any, any, any, any>,
  BoundPageFns<any, any>
>();

function pageFnsFor<TData, TError>(
  stream: InfiniteQueryStream<any, TError, TData, any, any>,
): BoundPageFns<TData, TError> {
  let fns = boundPageFns.get(stream) as BoundPageFns<TData, TError> | undefined;
  if (!fns) {
    fns = {
      fetchNextPage: (options) =>
        eager(
          () =>
            stream.fetch({
              ...options,
              meta: { fetchMore: { direction: "forward" } },
            }) as Promise<InfiniteQueryResult<TData, TError>>,
        ),
      fetchPreviousPage: (options) =>
        eager(
          () =>
            stream.fetch({
              ...options,
              meta: { fetchMore: { direction: "backward" } },
            }) as Promise<InfiniteQueryResult<TData, TError>>,
        ),
    };
    boundPageFns.set(stream, fns);
  }
  return fns;
}

// CLASS

/**
 * `QueryStream` specialisation for infinite queries: routes fetches through
 * `infiniteQueryBehavior` (via `_type: "infinite"`) and enriches results with
 * page controls.
 */
export class InfiniteQueryStream<
  TQueryFnData = unknown,
  TError = DefaultError,
  TData = InfiniteData<TQueryFnData>,
  TQueryKey extends QueryKey = QueryKey,
  TPageParam = unknown,
> extends QueryStream<
  TQueryFnData,
  TError,
  TData,
  InfiniteData<TQueryFnData, TPageParam>,
  TQueryKey
> {
  constructor(
    client: QueryClient,
    options: InfiniteQueryStreamOptions<
      TQueryFnData,
      TError,
      TData,
      TQueryKey,
      TPageParam
    >,
  ) {
    super(client, {
      ...options,
      _type: "infinite",
    } as unknown as QueryStreamOptions<
      TQueryFnData,
      TError,
      TData,
      InfiniteData<TQueryFnData, TPageParam>,
      TQueryKey
    >);
  }

  override setOptions(
    options: QueryStreamOptions<
      TQueryFnData,
      TError,
      TData,
      InfiniteData<TQueryFnData, TPageParam>,
      TQueryKey
    >,
  ): void {
    super.setOptions({ ...options, _type: "infinite" });
  }

  protected override createResult(
    query: Query<
      TQueryFnData,
      TError,
      InfiniteData<TQueryFnData, TPageParam>,
      TQueryKey
    >,
    options: QueryStreamOptions<
      TQueryFnData,
      TError,
      TData,
      InfiniteData<TQueryFnData, TPageParam>,
      TQueryKey
    >,
  ): InfiniteQueryResult<TData, TError> {
    const { state } = query;
    const parentResult = super.createResult(query, options);

    const { isFetching, isRefetching, isError, isRefetchError } = parentResult;
    const fetchDirection = state.fetchMeta?.fetchMore?.direction;

    const isFetchNextPageError = isError && fetchDirection === "forward";
    const isFetchingNextPage = isFetching && fetchDirection === "forward";

    const isFetchPreviousPageError = isError && fetchDirection === "backward";
    const isFetchingPreviousPage = isFetching && fetchDirection === "backward";

    const pageParamsOptions =
      options as unknown as InfiniteQueryPageParamsOptions<any, any>;
    const { fetchNextPage, fetchPreviousPage } = pageFnsFor<TData, TError>(
      this,
    );

    const result: InfiniteQueryResult<TData, TError> = {
      ...parentResult,
      fetchNextPage,
      fetchPreviousPage,
      hasNextPage: hasNextPage(pageParamsOptions, state.data),
      hasPreviousPage: hasPreviousPage(pageParamsOptions, state.data),
      isFetchNextPageError,
      isFetchingNextPage,
      isFetchPreviousPageError,
      isFetchingPreviousPage,
      isRefetchError:
        isRefetchError && !isFetchNextPageError && !isFetchPreviousPageError,
      isRefetching:
        isRefetching && !isFetchingNextPage && !isFetchingPreviousPage,
    };

    return result;
  }
}

// PUBLIC FACTORY

/**
 * Creates the `Observable<InfiniteQueryResult>` behind `client.infiniteQuery$()`.
 */
export function createInfiniteQueryStream<
  TQueryFnData = unknown,
  TError = DefaultError,
  TData = InfiniteData<TQueryFnData>,
  TQueryKey extends QueryKey = QueryKey,
  TPageParam = unknown,
>(
  client: QueryClient,
  optionsInput:
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
  return createStreamObservable(
    client,
    optionsInput,
    (options) => new InfiniteQueryStream(client, options),
  ) as Observable<InfiniteQueryResult<TData, TError>>;
}
