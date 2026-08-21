import type {
  DefaultError,
  QueryKey,
  QueryStreamOptions,
  WithRequired,
} from "./types";

/**
 * Identity helper that preserves inference for shared query definitions:
 *
 * ```ts
 * const todosOptions = queryOptions({
 *   queryKey: ['todos'],
 *   queryFn: fetchTodos,
 * })
 * client.query$(todosOptions)
 * ```
 */
export function queryOptions<
  TQueryFnData = unknown,
  TError = DefaultError,
  TData = TQueryFnData,
  const TQueryKey extends QueryKey = QueryKey,
>(
  options: WithRequired<
    QueryStreamOptions<TQueryFnData, TError, TData, TQueryFnData, TQueryKey>,
    "queryKey"
  >,
): WithRequired<
  QueryStreamOptions<TQueryFnData, TError, TData, TQueryFnData, TQueryKey>,
  "queryKey"
> {
  return options;
}
