import {
  EMPTY,
  Subject,
  fromEvent,
  ignoreElements,
  map,
  merge,
  share,
  tap,
} from "rxjs";
import type { Observable } from "rxjs";

/**
 * Tracks network connectivity. `online$` emits on every state change coming
 * from `online`/`offline` window events or manual `setOnline()` calls. DOM
 * event listeners are only attached while `online$` has subscribers.
 */
export class OnlineManager {
  #online = true;
  #manual = new Subject<boolean>();

  readonly online$: Observable<boolean>;

  constructor() {
    // addEventListener does not exist in React Native, but window does
    const events$: Observable<boolean> =
      typeof window !== "undefined" &&
      typeof window.addEventListener === "function"
        ? merge(
            fromEvent(window, "online").pipe(map(() => true)),
            fromEvent(window, "offline").pipe(map(() => false)),
          )
        : EMPTY;

    this.online$ = merge(
      this.#manual,
      // route events through setOnline so #online stays current and
      // duplicate events are deduplicated, then let #manual re-emit
      events$.pipe(
        tap((online) => this.setOnline(online)),
        ignoreElements(),
      ),
    ).pipe(share({ resetOnRefCountZero: true }));
  }

  setOnline(online: boolean): void {
    const changed = this.#online !== online;

    if (changed) {
      this.#online = online;
      this.#manual.next(online);
    }
  }

  isOnline(): boolean {
    return this.#online;
  }
}

export const onlineManager = new OnlineManager();
