import { Subject, concat, defer, from, of } from "rxjs";
import type { Observable } from "rxjs";
import { getDefaultState } from "./mutation";
import { hashKey, shallowEqualObjects } from "./utils";
import type { QueryClient } from "./queryClient";
import type {
  DefaultError,
  MutateOptions,
  MutationFunctionContext,
  MutationOptions,
} from "./types";
import type {
  Action,
  Mutation,
  MutationObserverLike,
  MutationState,
} from "./mutation";

// TYPES

export interface MutationResult<
  TData = unknown,
  TError = DefaultError,
  TVariables = unknown,
  TOnMutateResult = unknown,
> extends MutationState<TData, TError, TVariables, TOnMutateResult> {
  isIdle: boolean;
  isPending: boolean;
  isSuccess: boolean;
  isError: boolean;
}

// CLASS

/**
 * A mutation handle — the RxJS equivalent of TanStack's `MutationObserver`.
 *
 * - `state$` emits the current mutation result immediately on subscribe and
 *   again on every state change.
 * - `mutate$(variables)` is a **cold** observable: each subscription executes
 *   the mutation once, emits the data (or errors) and completes.
 */
export class MutationStream<
  TData = unknown,
  TError = DefaultError,
  TVariables = unknown,
  TOnMutateResult = unknown,
> implements MutationObserverLike<TData, TError, TVariables, TOnMutateResult> {
  options!: MutationOptions<TData, TError, TVariables, TOnMutateResult>;

  #client: QueryClient;
  #currentResult: MutationResult<TData, TError, TVariables, TOnMutateResult> =
    undefined!;
  #currentMutation?:
    | Mutation<TData, TError, TVariables, TOnMutateResult>
    | undefined;
  #mutateOptions?:
    | MutateOptions<TData, TError, TVariables, TOnMutateResult>
    | undefined;
  #results = new Subject<
    MutationResult<TData, TError, TVariables, TOnMutateResult>
  >();

  readonly state$: Observable<
    MutationResult<TData, TError, TVariables, TOnMutateResult>
  >;

  constructor(
    client: QueryClient,
    options: MutationOptions<TData, TError, TVariables, TOnMutateResult>,
  ) {
    this.#client = client;
    this.setOptions(options);
    this.#updateResult();
    this.state$ = defer(() => concat(of(this.#currentResult), this.#results));
  }

  setOptions(
    options: MutationOptions<TData, TError, TVariables, TOnMutateResult>,
  ): void {
    const prevOptions = this.options as
      MutationOptions<TData, TError, TVariables, TOnMutateResult> | undefined;
    this.options = this.#client.defaultMutationOptions(options);
    if (!shallowEqualObjects(this.options, prevOptions)) {
      this.#client.mutationCache.notify({
        type: "observerOptionsUpdated",
        mutation: this.#currentMutation as Mutation<any, any, any, any>,
        observer: this,
      });
    }

    if (
      prevOptions?.mutationKey &&
      this.options.mutationKey &&
      hashKey(prevOptions.mutationKey) !== hashKey(this.options.mutationKey)
    ) {
      this.reset();
    } else if (this.#currentMutation?.state.status === "pending") {
      this.#currentMutation.setOptions(this.options);
    }
  }

  onMutationUpdate(
    action: Action<TData, TError, TVariables, TOnMutateResult>,
  ): void {
    this.#updateResult();

    this.#notify(action);
  }

  getCurrentResult(): MutationResult<
    TData,
    TError,
    TVariables,
    TOnMutateResult
  > {
    return this.#currentResult;
  }

  reset(): void {
    // reset needs to remove the observer from the mutation because there is
    // no way to "get it back" — another mutate call yields a new mutation!
    this.#currentMutation?.removeObserver(this);
    this.#currentMutation = undefined;
    this.#updateResult();
    this.#notify();
  }

  /**
   * Cold: each subscription executes the mutation once. The observable emits
   * the mutation result data and completes, or errors with the mutation error.
   */
  mutate$(
    variables: TVariables,
    options?: MutateOptions<TData, TError, TVariables, TOnMutateResult>,
  ): Observable<TData> {
    return defer(() => from(this.#mutate(variables, options)));
  }

  #mutate(
    variables: TVariables,
    options?: MutateOptions<TData, TError, TVariables, TOnMutateResult>,
  ): Promise<TData> {
    this.#mutateOptions = options;

    this.#currentMutation?.removeObserver(this);

    this.#currentMutation = this.#client.mutationCache.build(
      this.#client,
      this.options,
    );

    this.#currentMutation.addObserver(this);

    return this.#currentMutation.execute(variables);
  }

  /** Detaches from the current mutation and completes `state$`. */
  destroy(): void {
    this.#currentMutation?.removeObserver(this);
    this.#currentMutation = undefined;
    this.#results.complete();
  }

  #updateResult(): void {
    const state =
      this.#currentMutation?.state ??
      getDefaultState<TData, TError, TVariables, TOnMutateResult>();

    this.#currentResult = {
      ...state,
      isPending: state.status === "pending",
      isSuccess: state.status === "success",
      isError: state.status === "error",
      isIdle: state.status === "idle",
    };
  }

  #notify(action?: Action<TData, TError, TVariables, TOnMutateResult>): void {
    // First trigger the per-call mutate callbacks
    if (this.#mutateOptions) {
      const variables = this.#currentResult.variables!;
      const onMutateResult = this.#currentResult.context;

      const context: MutationFunctionContext = {
        client: this.#client,
        meta: this.options.meta,
        mutationKey: this.options.mutationKey,
      };

      if (action?.type === "success") {
        try {
          this.#mutateOptions.onSuccess?.(
            action.data,
            variables,
            onMutateResult,
            context,
          );
        } catch (e) {
          void Promise.reject(e);
        }
        try {
          this.#mutateOptions.onSettled?.(
            action.data,
            null,
            variables,
            onMutateResult,
            context,
          );
        } catch (e) {
          void Promise.reject(e);
        }
      } else if (action?.type === "error") {
        try {
          this.#mutateOptions.onError?.(
            action.error,
            variables,
            onMutateResult,
            context,
          );
        } catch (e) {
          void Promise.reject(e);
        }
        try {
          this.#mutateOptions.onSettled?.(
            undefined,
            action.error,
            variables,
            onMutateResult,
            context,
          );
        } catch (e) {
          void Promise.reject(e);
        }
      }
    }

    // Then emit the result
    this.#results.next(this.#currentResult);
  }
}
