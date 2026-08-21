import { noop } from "./utils";
import type {
  DefaultError,
  MutationKey,
  MutationMeta,
  MutationOptions,
  MutationScope,
  QueryKey,
  QueryMeta,
  QueryOptions,
} from "./types";
import type { QueryClient } from "./queryClient";
import type { Query, QueryState } from "./query";
import type { Mutation, MutationState } from "./mutation";

// TYPES

type TransformerFn = (data: any) => any;
function defaultTransformerFn(data: any): any {
  return data;
}

function tryResolveSync(promise: PromiseLike<unknown>) {
  let data: unknown;

  const thenResult = promise.then((result) => {
    data = result;
    return result;
  }, noop) as Promise<unknown> | undefined;

  // .catch can be unavailable on certain kinds of thenables
  thenResult?.catch?.(noop);

  if (data !== undefined) {
    return { data };
  }

  return undefined;
}

export interface DehydrateOptions {
  serializeData?: TransformerFn;
  shouldDehydrateMutation?: (mutation: Mutation) => boolean;
  shouldDehydrateQuery?: (query: Query) => boolean;
  shouldRedactErrors?: (error: unknown) => boolean;
}

export interface HydrateOptions {
  defaultOptions?: {
    deserializeData?: TransformerFn;
    queries?: QueryOptions;
    mutations?: MutationOptions<unknown, DefaultError, unknown, unknown>;
  };
}

interface DehydratedMutation {
  mutationKey?: MutationKey | undefined;
  state: MutationState;
  meta?: MutationMeta;
  scope?: MutationScope;
}

interface DehydratedQuery {
  queryHash: string;
  queryKey: QueryKey;
  state: QueryState;
  promise?: Promise<unknown> | undefined;
  meta?: QueryMeta;
  queryType?: "infinite";
  dehydratedAt?: number;
}

export interface DehydratedState {
  mutations: Array<DehydratedMutation>;
  queries: Array<DehydratedQuery>;
}

// FUNCTIONS

function dehydrateMutation(mutation: Mutation): DehydratedMutation {
  return {
    mutationKey: mutation.options.mutationKey,
    state: mutation.state,
    ...(mutation.options.scope && { scope: mutation.options.scope }),
    ...(mutation.meta && { meta: mutation.meta }),
  };
}

// Most config is not dehydrated but instead meant to configure again when
// consuming the de/rehydrated data, typically with query$ on the client.
function dehydrateQuery(
  query: Query,
  serializeData: TransformerFn,
  shouldRedactErrors: (error: unknown) => boolean,
): DehydratedQuery {
  const dehydratePromise = () => {
    const promise = query.promise?.then(serializeData).catch((error) => {
      if (!shouldRedactErrors(error)) {
        // Reject original error if it should not be redacted
        return Promise.reject(error);
      }
      return Promise.reject(new Error("redacted"));
    });

    // We need the promise we dehydrate to reject to get the correct result
    // into the query cache, but we also want to avoid unhandled promise
    // rejections in whatever environment the prefetches are happening in.
    promise?.catch(noop);

    return promise;
  };

  return {
    dehydratedAt: Date.now(),
    state: {
      ...query.state,
      ...(query.state.data !== undefined && {
        data: serializeData(query.state.data),
      }),
    },
    queryKey: query.queryKey,
    queryHash: query.queryHash,
    ...(query.state.status === "pending" && {
      promise: dehydratePromise(),
    }),
    ...(query.meta && { meta: query.meta }),
    ...(query.queryType && { queryType: query.queryType }),
  };
}

export function defaultShouldDehydrateMutation(mutation: Mutation) {
  return mutation.state.isPaused;
}

export function defaultShouldDehydrateQuery(query: Query) {
  return query.state.status === "success";
}

function defaultShouldRedactErrors(_: unknown) {
  return true;
}

export function dehydrate(
  client: QueryClient,
  options: DehydrateOptions = {},
): DehydratedState {
  const filterMutation =
    options.shouldDehydrateMutation ??
    client.getDefaultOptions().dehydrate?.shouldDehydrateMutation ??
    defaultShouldDehydrateMutation;

  const mutations = client.mutationCache
    .getAll()
    .flatMap((mutation) =>
      filterMutation(mutation) ? [dehydrateMutation(mutation)] : [],
    );

  const filterQuery =
    options.shouldDehydrateQuery ??
    client.getDefaultOptions().dehydrate?.shouldDehydrateQuery ??
    defaultShouldDehydrateQuery;

  const shouldRedactErrors =
    options.shouldRedactErrors ??
    client.getDefaultOptions().dehydrate?.shouldRedactErrors ??
    defaultShouldRedactErrors;

  const serializeData =
    options.serializeData ??
    client.getDefaultOptions().dehydrate?.serializeData ??
    defaultTransformerFn;

  const queries = client.queryCache
    .getAll()
    .flatMap((query) =>
      filterQuery(query)
        ? [dehydrateQuery(query, serializeData, shouldRedactErrors)]
        : [],
    );

  return { mutations, queries };
}

export function hydrate(
  client: QueryClient,
  dehydratedState: unknown,
  options?: HydrateOptions,
): void {
  if (typeof dehydratedState !== "object" || dehydratedState === null) {
    return;
  }

  const mutationCache = client.mutationCache;
  const queryCache = client.queryCache;
  const deserializeData =
    options?.defaultOptions?.deserializeData ??
    client.getDefaultOptions().hydrate?.deserializeData ??
    defaultTransformerFn;

  const mutations = (dehydratedState as DehydratedState).mutations || [];
  const queries = (dehydratedState as DehydratedState).queries || [];

  mutations.forEach(({ state, ...mutationOptions }) => {
    mutationCache.build(
      client,
      {
        ...client.getDefaultOptions().hydrate?.mutations,
        ...options?.defaultOptions?.mutations,
        ...mutationOptions,
      },
      state,
    );
  });

  queries.forEach(
    ({
      queryKey,
      state,
      queryHash,
      meta,
      promise,
      dehydratedAt,
      queryType,
    }) => {
      const syncData = promise ? tryResolveSync(promise) : undefined;
      const rawData = state.data === undefined ? syncData?.data : state.data;
      const data = rawData === undefined ? rawData : deserializeData(rawData);

      let query = queryCache.get(queryHash);
      const existingQueryIsPending = query?.state.status === "pending";
      const existingQueryIsFetching = query?.state.fetchStatus === "fetching";

      // Do not hydrate if an existing query exists with newer data
      if (query) {
        const hasNewerSyncData =
          syncData &&
          dehydratedAt !== undefined &&
          dehydratedAt > query.state.dataUpdatedAt;
        if (
          state.dataUpdatedAt > query.state.dataUpdatedAt ||
          hasNewerSyncData
        ) {
          // Omit fetchStatus from dehydrated state so that the query stays in
          // its current fetchStatus
          const { fetchStatus: _ignored, ...serializedState } = state;
          query.setState({
            ...serializedState,
            data,
            // If the query was pending at the moment of dehydration, but
            // resolved to have data before hydration, we can assume the query
            // should be hydrated as successful.
            ...(state.status === "pending" &&
              data !== undefined && {
                status: "success" as const,
                dataUpdatedAt: dehydratedAt ?? Date.now(),
                // Preserve existing fetchStatus if actively fetching
                ...(!existingQueryIsFetching && {
                  fetchStatus: "idle" as const,
                }),
              }),
          });
        }
      } else {
        // Restore query
        query = queryCache.build(
          client,
          {
            ...client.getDefaultOptions().hydrate?.queries,
            ...options?.defaultOptions?.queries,
            queryKey,
            queryHash,
            meta,
            _type: queryType,
          },
          // Reset fetch status to idle to avoid the query being stuck in
          // fetching state upon hydration
          {
            ...state,
            data,
            fetchStatus: "idle",
            status:
              state.status === "pending" && data !== undefined
                ? "success"
                : state.status,
            ...(state.status === "pending" &&
              data !== undefined && {
                dataUpdatedAt: dehydratedAt ?? Date.now(),
              }),
          },
        );
      }

      if (
        promise &&
        // If the data was synchronously available, there is no need to set up
        // a retryer and thus no reason to call fetch
        !syncData &&
        !existingQueryIsPending &&
        !existingQueryIsFetching &&
        // Only hydrate if dehydration is newer than any existing data,
        // this is always true for new queries
        (dehydratedAt === undefined || dehydratedAt > query.state.dataUpdatedAt)
      ) {
        // This doesn't actually fetch - it just creates a retryer
        // which will re-use the passed `initialPromise`
        void query
          .fetch(undefined, {
            initialPromise: Promise.resolve(promise).then(deserializeData),
          })
          .catch(noop);
      }
    },
  );
}
