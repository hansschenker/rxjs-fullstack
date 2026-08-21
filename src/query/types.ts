import type { Observable } from "rxjs";
import type { Query, QueryBehavior } from "./query";
import type { QueryClient } from "./queryClient";
import type { QueryCache } from "./queryCache";
import type { Mutation } from "./mutation";
import type { MutationCache } from "./mutationCache";
import type { SkipToken } from "./utils";

/**
 * Module-augmentable registry, mirroring TanStack Query's `Register` pattern:
 *
 * ```ts
 * declare module '@netxpert/rxjs-query' {
 *   interface Register { defaultError: AxiosError }
 * }
 * ```
 */
export interface Register {
  // defaultError: Error
  // queryMeta: Record<string, unknown>
}

export type DefaultError = Register extends { defaultError: infer TError }
  ? TError
  : Error;

export type QueryKey = ReadonlyArray<unknown>;

export type QueryMeta = Register extends { queryMeta: infer TMeta }
  ? TMeta extends Record<string, unknown>
    ? TMeta
    : Record<string, unknown>
  : Record<string, unknown>;

export type QueryStatus = "pending" | "error" | "success";
export type FetchStatus = "fetching" | "paused" | "idle";
export type NetworkMode = "online" | "always" | "offlineFirst";

export type StaleTime = number | "static";

export type StaleTimeFunction<
  TQueryFnData = unknown,
  TError = DefaultError,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
> = (query: Query<TQueryFnData, TError, TData, TQueryKey>) => StaleTime;

/** `boolean`, or a callback deriving a boolean from the query. */
export type QueryBooleanOption<
  TQueryFnData = unknown,
  TError = DefaultError,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
> =
  boolean | ((query: Query<TQueryFnData, TError, TData, TQueryKey>) => boolean);

export interface QueryFunctionContext<
  TQueryKey extends QueryKey = QueryKey,
  TPageParam = never,
> {
  client: QueryClient;
  queryKey: TQueryKey;
  signal: AbortSignal;
  meta: QueryMeta | undefined;
  pageParam?: TPageParam;
  direction?: unknown;
}

export type QueryFunction<
  T = unknown,
  TQueryKey extends QueryKey = QueryKey,
  TPageParam = never,
> = (context: QueryFunctionContext<TQueryKey, TPageParam>) => T | Promise<T>;

export type InitialDataFunction<T> = () => T | undefined;

export type PlaceholderDataFunction<
  TQueryFnData = unknown,
  TError = DefaultError,
  TQueryData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
> = (
  previousData: TQueryData | undefined,
  previousQuery: Query<TQueryFnData, TError, TQueryData, TQueryKey> | undefined,
) => TQueryData | undefined;

export type RetryValue<TError> =
  boolean | number | ((failureCount: number, error: TError) => boolean);

export type RetryDelayValue<TError> =
  number | ((failureCount: number, error: TError) => number);

export interface QueryOptions<
  TQueryFnData = unknown,
  TError = DefaultError,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
> {
  queryKey?: TQueryKey;
  queryFn?: QueryFunction<TQueryFnData, TQueryKey> | SkipToken;
  queryHash?: string;
  queryKeyHashFn?: (queryKey: TQueryKey) => string;
  initialData?: TData | InitialDataFunction<TData>;
  initialDataUpdatedAt?: number | (() => number | undefined);
  meta?: QueryMeta | undefined;
  networkMode?: NetworkMode;
  gcTime?: number;
  retry?: RetryValue<TError>;
  retryDelay?: RetryDelayValue<TError>;
  structuralSharing?:
    boolean | ((oldData: unknown | undefined, newData: unknown) => unknown);
  behavior?: QueryBehavior<TQueryFnData, TError, TData, TQueryKey>;
  _defaulted?: boolean;
  _type?: "infinite" | undefined;
}

export type RefetchOnTrigger<
  TQueryFnData = unknown,
  TError = DefaultError,
  TQueryData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
> =
  | boolean
  | "always"
  | ((
      query: Query<TQueryFnData, TError, TQueryData, TQueryKey>,
    ) => boolean | "always");

type NonFunctionGuard<T> = T extends Function ? never : T;

/** Options accepted by `client.query$()` — the QueryObserver options equivalent. */
export interface QueryStreamOptions<
  TQueryFnData = unknown,
  TError = DefaultError,
  TData = TQueryFnData,
  TQueryData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
> extends QueryOptions<TQueryFnData, TError, TQueryData, TQueryKey> {
  /** Set to `false` to disable automatic fetching. Defaults to `true`. */
  enabled?: QueryBooleanOption<TQueryFnData, TError, TQueryData, TQueryKey>;
  /** Time in ms after which data is considered stale. `'static'` means never stale. */
  staleTime?:
    StaleTime | StaleTimeFunction<TQueryFnData, TError, TQueryData, TQueryKey>;
  refetchInterval?:
    | number
    | false
    | ((
        query: Query<TQueryFnData, TError, TQueryData, TQueryKey>,
      ) => number | false | undefined);
  refetchIntervalInBackground?: boolean;
  refetchOnWindowFocus?: RefetchOnTrigger<
    TQueryFnData,
    TError,
    TQueryData,
    TQueryKey
  >;
  refetchOnReconnect?: RefetchOnTrigger<
    TQueryFnData,
    TError,
    TQueryData,
    TQueryKey
  >;
  refetchOnMount?: RefetchOnTrigger<
    TQueryFnData,
    TError,
    TQueryData,
    TQueryKey
  >;
  retryOnMount?: QueryBooleanOption<
    TQueryFnData,
    TError,
    TQueryData,
    TQueryKey
  >;
  select?: (data: TQueryData) => TData;
  placeholderData?:
    | NonFunctionGuard<TQueryData>
    | PlaceholderDataFunction<TQueryFnData, TError, TQueryData, TQueryKey>;
}

export type DefaultedQueryStreamOptions<
  TQueryFnData = unknown,
  TError = DefaultError,
  TData = TQueryFnData,
  TQueryData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
> = WithRequired<
  QueryStreamOptions<TQueryFnData, TError, TData, TQueryData, TQueryKey>,
  "queryHash" | "queryKey"
>;

export interface FetchQueryOptions<
  TQueryFnData = unknown,
  TError = DefaultError,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
> extends WithRequired<
  QueryOptions<TQueryFnData, TError, TData, TQueryKey>,
  "queryKey"
> {
  /** Only fetch when data is older than this. Defaults to `0`, i.e. always fetch. */
  staleTime?:
    StaleTime | StaleTimeFunction<TQueryFnData, TError, TData, TQueryKey>;
}

export interface EnsureQueryDataOptions<
  TQueryFnData = unknown,
  TError = DefaultError,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
> extends FetchQueryOptions<TQueryFnData, TError, TData, TQueryKey> {
  revalidateIfStale?: boolean;
}

export interface QueryResult<TData = unknown, TError = DefaultError> {
  status: QueryStatus;
  fetchStatus: FetchStatus;
  isPending: boolean;
  isSuccess: boolean;
  isError: boolean;
  isLoading: boolean;
  data: TData | undefined;
  dataUpdatedAt: number;
  error: TError | null;
  errorUpdatedAt: number;
  failureCount: number;
  failureReason: TError | null;
  errorUpdateCount: number;
  isFetched: boolean;
  isFetchedAfterMount: boolean;
  isFetching: boolean;
  isRefetching: boolean;
  isLoadingError: boolean;
  isRefetchError: boolean;
  isPaused: boolean;
  isPlaceholderData: boolean;
  isStale: boolean;
  isEnabled: boolean;
  /** Eagerly refetches this query; the returned observable replays the settled result. */
  refetch: (options?: RefetchOptions) => Observable<QueryResult<TData, TError>>;
}

export interface RefetchOptions {
  throwOnError?: boolean;
  cancelRefetch?: boolean;
}

export type InvalidateOptions = RefetchOptions;
export type ResetOptions = RefetchOptions;

export interface CancelOptions {
  revert?: boolean;
  silent?: boolean;
}

export interface SetDataOptions {
  updatedAt?: number;
}

export interface DehydrateDefaultOptions {
  serializeData?: (data: any) => any;
  shouldDehydrateMutation?: (mutation: Mutation) => boolean;
  shouldDehydrateQuery?: (query: Query) => boolean;
  shouldRedactErrors?: (error: unknown) => boolean;
}

export interface HydrateDefaultOptions {
  deserializeData?: (data: any) => any;
  queries?: QueryOptions;
  mutations?: MutationOptions<unknown, DefaultError, unknown, unknown>;
}

export interface DefaultOptions<TError = DefaultError> {
  queries?: OmitKeyof<
    QueryStreamOptions<unknown, TError>,
    "queryKey" | "queryHash" | "select" | "initialData"
  >;
  mutations?: MutationOptions<unknown, TError, unknown, unknown>;
  dehydrate?: DehydrateDefaultOptions;
  hydrate?: HydrateDefaultOptions;
}

export interface QueryClientConfig {
  queryCache?: QueryCache;
  mutationCache?: MutationCache;
  defaultOptions?: DefaultOptions;
}

// UTILITY TYPES

export type WithRequired<TTarget, TKey extends keyof TTarget> = TTarget & {
  [_ in TKey]-?: Exclude<TTarget[_], undefined>;
};

export type OmitKeyof<TObject, TKey extends keyof TObject> = Omit<
  TObject,
  TKey
>;

export interface NotifyEvent {
  type: string;
}

// MUTATION TYPES

export type MutationKey = ReadonlyArray<unknown>;

export type MutationStatus = "idle" | "pending" | "success" | "error";

export type MutationMeta = Register extends { mutationMeta: infer TMeta }
  ? TMeta extends Record<string, unknown>
    ? TMeta
    : Record<string, unknown>
  : Record<string, unknown>;

export interface MutationScope {
  id: string;
}

export interface MutationFunctionContext {
  client: QueryClient;
  meta: MutationMeta | undefined;
  mutationKey?: MutationKey | undefined;
}

export type MutationFunction<TData = unknown, TVariables = unknown> = (
  variables: TVariables,
  context: MutationFunctionContext,
) => Promise<TData>;

export interface MutationOptions<
  TData = unknown,
  TError = DefaultError,
  TVariables = unknown,
  TOnMutateResult = unknown,
> {
  mutationFn?: MutationFunction<TData, TVariables>;
  mutationKey?: MutationKey | undefined;
  onMutate?: (
    variables: TVariables,
    context: MutationFunctionContext,
  ) => Promise<TOnMutateResult | undefined> | TOnMutateResult | undefined;
  onSuccess?: (
    data: TData,
    variables: TVariables,
    onMutateResult: TOnMutateResult,
    context: MutationFunctionContext,
  ) => Promise<unknown> | unknown;
  onError?: (
    error: TError,
    variables: TVariables,
    onMutateResult: TOnMutateResult | undefined,
    context: MutationFunctionContext,
  ) => Promise<unknown> | unknown;
  onSettled?: (
    data: TData | undefined,
    error: TError | null,
    variables: TVariables,
    onMutateResult: TOnMutateResult | undefined,
    context: MutationFunctionContext,
  ) => Promise<unknown> | unknown;
  retry?: RetryValue<TError>;
  retryDelay?: RetryDelayValue<TError>;
  networkMode?: NetworkMode;
  gcTime?: number;
  scope?: MutationScope;
  meta?: MutationMeta;
  _defaulted?: boolean;
}

/** Per-call callbacks for `mutate$`. */
export interface MutateOptions<
  TData = unknown,
  TError = DefaultError,
  TVariables = unknown,
  TOnMutateResult = unknown,
> {
  onSuccess?: (
    data: TData,
    variables: TVariables,
    onMutateResult: TOnMutateResult | undefined,
    context: MutationFunctionContext,
  ) => void;
  onError?: (
    error: TError,
    variables: TVariables,
    onMutateResult: TOnMutateResult | undefined,
    context: MutationFunctionContext,
  ) => void;
  onSettled?: (
    data: TData | undefined,
    error: TError | null,
    variables: TVariables,
    onMutateResult: TOnMutateResult | undefined,
    context: MutationFunctionContext,
  ) => void;
}

// INFINITE QUERY TYPES

export interface InfiniteData<TData, TPageParam = unknown> {
  pages: Array<TData>;
  pageParams: Array<TPageParam>;
}

export type GetNextPageParamFunction<TPageParam, TQueryFnData = unknown> = (
  lastPage: TQueryFnData,
  allPages: Array<TQueryFnData>,
  lastPageParam: TPageParam,
  allPageParams: Array<TPageParam>,
) => TPageParam | undefined | null;

export type GetPreviousPageParamFunction<TPageParam, TQueryFnData = unknown> = (
  firstPage: TQueryFnData,
  allPages: Array<TQueryFnData>,
  firstPageParam: TPageParam,
  allPageParams: Array<TPageParam>,
) => TPageParam | undefined | null;

export interface InfiniteQueryPageParamsOptions<
  TQueryFnData = unknown,
  TPageParam = unknown,
> {
  initialPageParam: TPageParam;
  getNextPageParam: GetNextPageParamFunction<TPageParam, TQueryFnData>;
  getPreviousPageParam?: GetPreviousPageParamFunction<TPageParam, TQueryFnData>;
  /** Maximum number of pages to keep in the cache. */
  maxPages?: number;
}

export interface InfiniteQueryStreamOptions<
  TQueryFnData = unknown,
  TError = DefaultError,
  TData = InfiniteData<TQueryFnData>,
  TQueryKey extends QueryKey = QueryKey,
  TPageParam = unknown,
>
  extends
    OmitKeyof<
      QueryStreamOptions<
        TQueryFnData,
        TError,
        TData,
        InfiniteData<TQueryFnData, TPageParam>,
        TQueryKey
      >,
      "queryFn"
    >,
    InfiniteQueryPageParamsOptions<TQueryFnData, TPageParam> {
  queryFn?: QueryFunction<TQueryFnData, TQueryKey, TPageParam> | SkipToken;
}

export interface FetchInfiniteQueryOptions<
  TQueryFnData = unknown,
  TError = DefaultError,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
  TPageParam = unknown,
> extends OmitKeyof<
  FetchQueryOptions<
    TQueryFnData,
    TError,
    InfiniteData<TData, TPageParam>,
    TQueryKey
  >,
  "queryFn"
> {
  initialPageParam: TPageParam;
  getNextPageParam?: GetNextPageParamFunction<TPageParam, TQueryFnData>;
  getPreviousPageParam?: GetPreviousPageParamFunction<TPageParam, TQueryFnData>;
  maxPages?: number;
  /** Number of pages to prefetch. Defaults to 1. */
  pages?: number;
  queryFn?: QueryFunction<TQueryFnData, TQueryKey, TPageParam> | SkipToken;
}

export interface FetchNextPageOptions {
  cancelRefetch?: boolean;
}

export interface FetchPreviousPageOptions {
  cancelRefetch?: boolean;
}
