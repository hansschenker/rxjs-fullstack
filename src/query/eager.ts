import { defer } from "rxjs";
import type { Observable } from "rxjs";
import { noop } from "./utils";

/**
 * Starts `work` immediately (eagerly) and returns an observable that replays
 * the settled outcome to every subscriber. This keeps imperative commands like
 * `invalidateQueries` observable-based without the "forgot to subscribe,
 * nothing happened" footgun of cold observables.
 */
export function eager<T>(work: () => Promise<T>): Observable<T> {
  const promise = work();
  // avoid unhandled rejection warnings when nobody subscribes
  promise.catch(noop);
  return defer(() => promise);
}
