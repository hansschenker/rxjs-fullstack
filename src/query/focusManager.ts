import { EMPTY, Subject, fromEvent, map, merge, share } from "rxjs";
import type { Observable } from "rxjs";

/**
 * Tracks window focus. `focused$` emits the current focus state on every
 * `visibilitychange` event and on manual `setFocused()` calls. DOM event
 * listeners are only attached while `focused$` has subscribers.
 */
export class FocusManager {
  #focused?: boolean | undefined;
  #manual = new Subject<boolean>();

  readonly focused$: Observable<boolean>;

  constructor() {
    // addEventListener does not exist in React Native, but window does
    const events$: Observable<unknown> =
      typeof window !== "undefined" &&
      typeof window.addEventListener === "function"
        ? fromEvent(window, "visibilitychange")
        : EMPTY;

    this.focused$ = merge(
      this.#manual,
      events$.pipe(map(() => this.isFocused())),
    ).pipe(share({ resetOnRefCountZero: true }));
  }

  /** Override the focus state (pass `undefined` to fall back to the document's visibility). */
  setFocused(focused?: boolean): void {
    const changed = this.#focused !== focused;
    if (changed) {
      this.#focused = focused;
      this.#manual.next(this.isFocused());
    }
  }

  isFocused(): boolean {
    if (typeof this.#focused === "boolean") {
      return this.#focused;
    }

    // document global can be unavailable in react native
    return globalThis.document?.visibilityState !== "hidden";
  }
}

export const focusManager = new FocusManager();
