import { Subject, Subscription } from "rxjs";
import type { Observable } from "rxjs";
import { QueryStream, createStreamObservable } from "./queryStream";
import { replaceEqualDeep, shallowEqualObjects } from "./utils";
import type { QueryClient } from "./queryClient";
import type {
  DefaultedQueryStreamOptions,
  QueryResult,
  QueryStreamOptions,
} from "./types";

// TYPES

type AnyOptions = QueryStreamOptions<any, any, any, any, any>;
type AnyStream = QueryStream<any, any, any, any, any>;

export type QueriesResults = Array<QueryResult<any, any>>;

export type CombineFn<TCombinedResult> = (
  results: QueriesResults,
) => TCombinedResult;

export interface QueriesStreamOptions<TCombinedResult = QueriesResults> {
  combine?: CombineFn<TCombinedResult>;
}

interface StreamMatch {
  options: DefaultedQueryStreamOptions<any, any, any, any, any>;
  stream: AnyStream;
}

function replaceAt<T>(array: Array<T>, index: number, value: T): Array<T> {
  const copy = array.slice(0);
  copy[index] = value;
  return copy;
}

// CLASS

/**
 * Port of TanStack's `QueriesObserver`: observes a dynamic list of queries as
 * one stream. Streams are reused by `queryHash` when the list changes, and an
 * optional `combine` function is memoized with structural sharing so the
 * combined result keeps its identity when nothing relevant changed.
 */
export class QueriesStream<TCombinedResult = QueriesResults> {
  #client: QueryClient;
  #combine?: CombineFn<TCombinedResult> | undefined;
  #streams: Array<AnyStream> = [];
  #childSubs = new Map<AnyStream, Subscription>();
  #result: QueriesResults = [];
  #combined?: TCombinedResult;
  #lastResult?: QueriesResults;
  #lastCombine?: CombineFn<TCombinedResult>;
  #active = false;
  #subject = new Subject<TCombinedResult>();

  readonly results$: Observable<TCombinedResult> = this.#subject.asObservable();

  constructor(
    client: QueryClient,
    queries: Array<AnyOptions>,
    options?: QueriesStreamOptions<TCombinedResult>,
  ) {
    this.#client = client;
    this.#combine = options?.combine;
    this.setQueries(queries);
  }

  /** StreamLike alias so `createStreamObservable` can push new query lists. */
  setOptions(queries: Array<AnyOptions>): void {
    this.setQueries(queries);
  }

  setQueries(queries: Array<AnyOptions>): void {
    const prevStreams = this.#streams;
    const matches = this.#findMatchingStreams(queries);

    // set options on the reused/new streams to notify of changes
    matches.forEach((match) => match.stream.setOptions(match.options));

    const newStreams = matches.map((match) => match.stream);
    const newResult = newStreams.map((stream) => stream.getCurrentResult());

    const hasLengthChange = prevStreams.length !== newStreams.length;
    const hasIndexChange = newStreams.some(
      (stream, index) => stream !== prevStreams[index],
    );
    const hasStructuralChange = hasLengthChange || hasIndexChange;

    const hasResultChange = hasStructuralChange
      ? true
      : newResult.some((result, index) => {
          const prev = this.#result[index];
          return !prev || !shallowEqualObjects(result, prev);
        });

    if (!hasStructuralChange && !hasResultChange) return;

    this.#streams = newStreams;
    this.#result = newResult;

    const removed = prevStreams.filter(
      (stream) => !newStreams.includes(stream),
    );

    if (!this.#active) {
      removed.forEach((stream) => stream.destroy());
      return;
    }

    if (hasStructuralChange) {
      removed.forEach((stream) => {
        this.#childSubs.get(stream)?.unsubscribe();
        this.#childSubs.delete(stream);
        stream.destroy();
      });
      newStreams
        .filter((stream) => !prevStreams.includes(stream))
        .forEach((stream) => this.#subscribeChild(stream));
      // mount fetches during subscription may have updated results already
      this.#result = this.#streams.map((stream) => stream.getCurrentResult());
    }

    this.#notify();
  }

  onSubscribe(): void {
    this.#active = true;
    this.#streams.forEach((stream) => this.#subscribeChild(stream));
    this.#result = this.#streams.map((stream) => stream.getCurrentResult());
  }

  destroy(): void {
    this.#active = false;
    this.#childSubs.forEach((sub) => sub.unsubscribe());
    this.#childSubs.clear();
    this.#streams.forEach((stream) => stream.destroy());
    this.#subject.complete();
  }

  getCurrentResult(): TCombinedResult {
    return this.#computeCombined();
  }

  getRawResults(): QueriesResults {
    return this.#result;
  }

  #subscribeChild(stream: AnyStream): void {
    this.#childSubs.set(
      stream,
      stream.results$.subscribe((result) => this.#onUpdate(stream, result)),
    );
    stream.onSubscribe();
  }

  #onUpdate(stream: AnyStream, result: QueryResult<any, any>): void {
    const index = this.#streams.indexOf(stream);
    if (index !== -1) {
      this.#result = replaceAt(this.#result, index, result);
      this.#notify();
    }
  }

  #computeCombined(): TCombinedResult {
    const combine = this.#combine;
    if (combine) {
      if (
        this.#combined === undefined ||
        this.#result !== this.#lastResult ||
        combine !== this.#lastCombine
      ) {
        this.#lastCombine = combine;
        this.#lastResult = this.#result;
        this.#combined = replaceEqualDeep(
          this.#combined,
          combine(this.#result),
        );
      }
      return this.#combined;
    }
    return this.#result as unknown as TCombinedResult;
  }

  #notify(): void {
    if (!this.#active) return;

    if (this.#combine) {
      const previous = this.#combined;
      const next = this.#computeCombined();
      if (previous !== next) {
        this.#subject.next(next);
      }
    } else {
      this.#subject.next(this.#result as unknown as TCombinedResult);
    }
  }

  #findMatchingStreams(queries: Array<AnyOptions>): Array<StreamMatch> {
    const prevStreamsMap = new Map<string, Array<AnyStream>>();

    this.#streams.forEach((stream) => {
      const key = stream.options.queryHash;
      const previous = prevStreamsMap.get(key);
      if (previous) {
        previous.push(stream);
      } else {
        prevStreamsMap.set(key, [stream]);
      }
    });

    return queries.map((options) => {
      const defaultedOptions = this.#client.defaultQueryOptions(options);
      const match = prevStreamsMap.get(defaultedOptions.queryHash)?.shift();
      return {
        options: defaultedOptions,
        stream: match ?? new QueryStream(this.#client, defaultedOptions),
      };
    });
  }
}

// PUBLIC FACTORY

/**
 * Creates the observable behind `client.queries$()`. Accepts a static list of
 * query options or an `Observable` of lists; emits the combined result (or the
 * raw result array when no `combine` is given).
 */
export function createQueriesStream<TCombinedResult = QueriesResults>(
  client: QueryClient,
  queriesInput: Array<AnyOptions> | Observable<Array<AnyOptions>>,
  options?: QueriesStreamOptions<TCombinedResult>,
): Observable<TCombinedResult> {
  return createStreamObservable(
    client,
    queriesInput,
    (queries) => new QueriesStream(client, queries, options),
  );
}
