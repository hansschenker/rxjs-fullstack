# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An experimental minimal fullstack framework whose execution model is RxJS: TypeScript JSX (no React) describes views, RxJS owns state/effects/cancellation, `rxjs-router` owns routing, Hono owns HTTP, and Bun hosts/builds the app. The README is the canonical design document, milestone narrative, and source for the public `rxjs-fullstack` project page.

Current milestones:

- M01 JSX runtime
- M02 DOM bindings
- M03 HTML/SSR renderer
- M04 Hono+Bun server
- M05 routing + Query/Cache
- M06 file-based route discovery
- M07 forms + RxJS server actions

The Query/Cache layer lives in `src/query/` and is framework-internal. App-level query definitions live in `src/queries/`.

M06 page routes live in `src/routes/*.tsx`. Each page module default-exports its `rxjs-router` route object. `scripts/generate-routes.ts` discovers those files and regenerates the complete typed route tree in `src/routes.generated.ts`; `src/routes.tsx` is only the stable public re-export.

M07 shared action references and the browser action transport live in `src/actions/`. Server-only action registration/execution lives in `src/server/action.ts`. Do not place server handlers in shared action-reference modules.

## Commands

- `bun run check` — generate routes + typecheck + verify + build both example clients. **This must pass before any change counts as done.**
- `bun run generate:routes` — regenerate the deterministic page-route tree.
- `bun run verify` — regenerate routes and run `scripts/verify.tsx`, the executable spec.
- `bun run typecheck` — regenerate routes and run `tsc --noEmit`.
- `bun run dev` — regenerate routes, then start the hot-reload dev server on port 3000.
- `bun run build:todos` — bundle the browser Todos sample.
- `bun run dev:todos` — build the browser Todos sample (router-driven shell with client-side navigation) and serve it on `http://localhost:3100`.

## CI environment setup

The runner needs Bun and the sibling `rxjs-router` repository because `package.json` currently uses `file:../rxjs-router`.

```bash
curl -fsSL https://bun.sh/install | bash
export PATH="$HOME/.bun/bin:$PATH"

git clone --depth 1 https://github.com/hansschenker/rxjs-router ../rxjs-router
(cd ../rxjs-router && bun install --production)

bun install
bun run check
```

The sibling production install is required because browser bundling follows `rxjs-router/dist/*.js` from the sibling directory and resolves its runtime `rxjs` dependency there.

## Architecture invariants

- **The HTML renderer never subscribes.** `renderToString()` is pure; Observable children/attributes reaching it are a `TypeError`. Server async work resolves before rendering.
- **The JSX runtime creates no DOM and owns no lifecycle.** It only creates/normalizes `ViewChild` descriptions.
- **Cancellation has one owner.** `mount(view, container)` returns the RxJS `Subscription` for the mounted view. Unsubscribing tears down listeners, child subscriptions, live regions, and DOM.
- **Events flow through Observers; meaning flows through RxJS pipelines.** Renderers forward events and do not interpret them.
- **Live form state binds to properties.** `value`/`checked`/`selected` are assigned as DOM properties — their attributes only set defaults and stop reflecting after user interaction. Everything else binds as an attribute; the SSR renderer keeps emitting attributes (that is how HTML expresses initial state).
- **Binding errors fail loudly.** An erroring Observable child or attribute tears its binding down (region cleared, attribute removed) and reports through `mount()`'s `onError` hook (default: rethrown as an unhandled error). Recovery via `catchError` belongs in the application pipeline, never in the renderer.
- **Keep RxJS operators visible.** Do not rename `map`, `scan`, `switchMap`, `concatMap`, `mergeMap`, or `exhaustMap` merely to give them domain names. Name the user/domain functions passed into them.
- **Flattening operators are policy.** `mergeMap` allows overlap, `switchMap` keeps latest, `concatMap` queues, and `exhaustMap` ignores while busy. M07 Todo submit intentionally uses `exhaustMap`.
- **Server action references are contracts, not handlers.** Shared action modules may contain action identity/types; server implementation belongs under `src/server/`.
- **Server action transport stays lazy/cancellable.** Browser invocation uses a cold `fromFetch` Observable so subscription starts the request and unsubscription aborts it. Do not convert the action boundary into an eager Promise API.
- **Server action execution is an RxJS dataflow.** `executeServerAction$()` defers input parsing and handler invocation until subscription. Hono consumes it at the HTTP boundary.
- **Forms are event sources.** Prefer form `submit` Observers and `FormData` from the submitting form over `document.querySelector()` workflows or click-specific mutation wiring.
- **Business logic remains in ordinary functions.** Action/HTTP adapters move typed packages; they do not know domain meaning.
- **`rxjs-router` owns routing semantics.** File discovery only locates/assembles route modules.
- **Page-route discovery is deterministic and strongly typed.** The generator sorts filenames and emits the complete root `createRoute({ children: [...] })` tree to preserve const-tuple inference.
- **Hono owns HTTP; Bun is only the runtime/build adapter.**
- **No React.** Do not add React/ReactDOM or React lifecycle/state idioms.

## README / project-page documentation standard

The root `README.md` is the canonical source for the public project page. Every milestone must keep it synchronized with the implementation and should be written for an interested technical reader, not only for contributors reading source code.

For each new milestone, document as applicable:

- the problem or limitation that existed before the milestone,
- the user-visible/framework capability that the milestone adds,
- what values/events flow over time,
- where subscription starts execution,
- concurrency and flattening policy,
- cancellation/teardown ownership,
- client/server and pure/effect boundaries,
- which technology owns each responsibility,
- representative code or timeline diagrams,
- the source-file map for the implementation,
- the executable verification/invariants that prove the milestone.

Do not reduce completed milestone sections to terse changelog entries. The README should remain suitable as the basis for the `rxjs-fullstack` project page and as a readable architectural history of how the framework evolved.

## Working style

- TypeScript strict; no new `any`; 2-space indent in application/framework files.
- Every new capability needs a corresponding invariant/check in `scripts/verify.tsx`.
- Keep the README milestone narrative synchronized with behavior and maintain the project-page documentation standard above.
- When triggered from an issue (`@claude` mention): work on a branch, open a PR, report `bun run check` results in the PR body, and do not merge.
