<p align="center">
  <img src="./assets/rxjs-fullstack-logo.webp" alt="RxJS Fullstack logo" width="360" />
</p>

# RxJS Fullstack

`rxjs-fullstack` is an experiment in a minimal fullstack web framework whose application execution model is RxJS.

The framework deliberately leaves existing technologies in charge of the jobs they already solve:

- **TypeScript** — language, strong typing, and JSX compilation.
- **RxJS 7** — lazy dataflows, state, effects, cancellation, sharing, and Query/Cache.
- **TypeScript JSX** — view syntax without React.
- **rxjs-router** — strongly typed route matching, navigation, request resolution, and route data.
- **Hono** — Web-API HTTP layer.
- **Bun** — reference runtime and build tool.

The central rule is: **RxJS is the application machine; the surrounding technologies remain thin, explicit boundaries.**

## Milestone status

```text
M01  TypeScript JSX runtime                         ✅
M02  RxJS DOM bindings                             ✅
M03  Pure HTML renderer + basic SSR               ✅
M04  Hono + Bun server                             ✅
M05  Strongly typed routing + Query/Cache         ✅
M06  File-based route discovery                   ✅
M07  Forms + RxJS server actions                  ✅
```

## M01 — TypeScript JSX runtime

M01 establishes a framework-owned view representation without React.

TypeScript compiles TSX directly to the framework's `jsx()` function and `Fragment` value. JSX therefore produces `ViewChild` values rather than DOM nodes or React elements.

The runtime supports primitives, intrinsic elements, fragments, function components, nested children, and RxJS Observables as live view values. It does not render, subscribe, create DOM, or own lifecycle.

The implementation lives in `src/jsx/runtime.ts`.

## M02 — RxJS DOM bindings

M02 interprets the same `ViewChild` representation in the browser.

`mount(view, container)` returns the RxJS `Subscription` that owns the mounted view's lifetime. Observable children and attributes are subscribed only when the view is mounted. Unsubscribing tears down event listeners, child subscriptions, live regions, and the mounted DOM.

DOM events flow into RxJS through `Observer`s:

```tsx
<button on={{ click: click$ }}>...</button>
```

The renderer only forwards event packages. Application meaning remains in the RxJS pipeline.

The implementation lives in `src/render/dom.ts`.

## M03 — Pure HTML renderer and SSR

M03 adds the server interpreter for the M01 view representation.

`renderToString()` is deliberately synchronous and pure. It renders already-resolved JSX values to HTML and **never subscribes to an Observable**. Observable children or attributes reaching the HTML renderer are rejected with a `TypeError`.

Server asynchronous work must therefore resolve before rendering:

```text
request
  ↓
route/request dataflow
  ↓
resolved model
  ↓
JSX
  ↓
renderToString()
  ↓
HTML
```

This keeps execution, cancellation, and subscription policy in RxJS rather than hiding them in rendering.

The implementation lives in `src/render/html.ts`.

## M04 — Hono + Bun server

M04 completes the first full server path.

Hono owns HTTP. Bun is only the reference runtime adapter. `src/server/app.tsx` defines the Web-API application, while `src/server/bun.ts` supplies the Bun `fetch` adapter and port.

The server path is:

```text
HTTP request
  ↓
Hono
  ↓
RxJS/router data resolution
  ↓
resolved page data
  ↓
JSX + pure HTML rendering
  ↓
Response
```

No framework semantics depend on Bun-specific APIs outside the runtime adapter.

## M05 — Strongly typed routing and Query/Cache

M05 adds reusable application infrastructure.

The running application uses the sibling `rxjs-router` package on both server and browser:

- server: `resolveRequest({ routes, request })`,
- browser: `createRouter({ routes, history })`,
- browser view state: `router.state$`.

The repository also retains the earlier typed-route experiment in `src/router/`, including path-literal-derived params and typed `href(...)` generation as a proof of the routing type model.

M05 also internalizes the Query/Cache layer under `src/query/`. Queries are Observables, mutations expose cold `mutate$()` streams, invalidation/refetching stays explicit, and the Todos vertical slice proves browser Query/Cache against a Hono API.

## M06 — File-based route discovery

M06 removes central manual registration of page route modules.

Page modules live in:

```text
src/routes/*.tsx
```

Each page module default-exports its `rxjs-router` route object. `scripts/generate-routes.ts` discovers the modules with `Bun.Glob`, sorts them deterministically, and writes the complete strongly typed root tree to `src/routes.generated.ts`.

```text
src/routes/*.tsx
      ↓
Bun.Glob discovery
      ↓
sorted imports
      ↓
generated createRoute({ children: [...] })
      ↓
src/routes.generated.ts
      ↓
src/routes.tsx public re-export
```

The generator only discovers and assembles modules. `rxjs-router` still owns route semantics: matching, params, loaders, navigation, redirects, cancellation, and request resolution.

Generating the root `createRoute()` call with its inline `children` tuple preserves TypeScript's exact route-tree inference.

`/about` is the M06 proof route: it participates in SSR without being manually imported into a central route registry.

## M07 — Forms + RxJS server actions

M07 moves the project from structural infrastructure into fullstack effects.

The Todos feature now uses a real HTML form as an RxJS event source:

```tsx
<form on={{ submit: submit$ }}>
  <input name="title" />
  <button type="submit">Add</button>
</form>
```

There is no `document.querySelector()` mutation workflow and no click-specific business path. The `SubmitEvent` itself carries the form boundary; `FormData` is read from the submitting form and converted into the typed domain input.

### Submit policy is visible

The application pipeline uses:

```text
submit$
  ↓
prevent browser navigation
  ↓
exhaustMap
  ↓
invoke server action
  ↓
invalidate todos query
  ↓
reset form / render status
```

`exhaustMap` is an intentional policy: **ignore new submissions while one save is in flight**.

The operator is not renamed behind a domain wrapper. The mechanism remains visible, while domain meaning lives in ordinary functions such as `createTodoInput()`.

### Shared typed action contract

A server action begins as a small shared typed reference:

```ts
export const createTodoAction = defineServerAction<CreateTodoInput, Todo>(
  'todos.create',
);
```

The reference contains identity plus TypeScript input/output information. It does not contain the server handler, so client bundles do not import server implementation code.

The shared action primitives live in `src/actions/`.

### Client execution is an Observable

`invokeServerAction$(action, input)` returns a cold RxJS Observable implemented with `fromFetch`.

Nothing executes until something subscribes to the action stream. Because `fromFetch` owns an `AbortController`, unsubscribing the action stream aborts the HTTP request. The mounted view's `Subscription` therefore remains the owner of browser action lifetime.

```text
subscription starts
      ↓
POST /api/actions/<action-id>
      ↓
response emits
      ↓
complete

unsubscribe before completion
      ↓
fetch aborts
```

M07 does not hide concurrency policy inside the action transport. The caller chooses `exhaustMap`, `switchMap`, `concatMap`, or `mergeMap` according to the desired application behavior.

### Server execution stays lazy

Hono registration is handled by `registerServerAction()` in `src/server/action.ts`.

The HTTP adapter parses the JSON envelope, then creates the server execution with `executeServerAction$()`. Input parsing and handler invocation are wrapped in `defer()`, so the server-side action remains a lazy RxJS dataflow until the HTTP boundary consumes it.

```text
HTTP POST
  ↓
Hono action route
  ↓
raw JSON
  ↓
subscribe to executeServerAction$()
  ↓
typed input parser
  ↓
Observable<Todo> handler
  ↓
JSON response
```

The Todo handler lifts the ordinary in-memory `addTodo()` operation into the server action dataflow. Hono does not know Todo business rules, and the action framework does not know what a Todo contains.

The old ad-hoc mutation route:

```text
POST /api/todos
```

has been removed. Todo creation now goes through:

```text
POST /api/actions/todos.create
```

The read side remains:

```text
GET /api/todos
```

After a successful action, the browser explicitly invalidates the Todos Query/Cache entry, which refetches the list through the existing query path.

### M07 verification

`scripts/verify.tsx` now checks that:

- server-action parsing is lazy before subscription,
- server-action handler execution is lazy before subscription,
- one subscription executes the handler once,
- valid Todo action input returns HTTP `201`,
- created data is visible through `GET /api/todos`,
- invalid action input returns HTTP `400`,
- the old `POST /api/todos` mutation path is gone.

The browser build typechecks the form event stream, action client, and Query/Cache invalidation pipeline.

## What M01–M07 establish

```text
M01  JSX is a typed description of a view.
M02  Browser execution is owned by RxJS Subscriptions.
M03  Server rendering is a pure step inside an RxJS dataflow.
M04  HTTP and runtime remain thin boundaries.
M05  Routing and Query/Cache provide application infrastructure.
M06  Route modules are discovered without central registration.
M07  Forms drive typed, lazy, cancellable RxJS server actions.
```

The current architecture is:

```text
TypeScript JSX
      ↓
framework ViewChild
      ↓
RxJS DOM bindings / pure SSR renderer
      ↓
file-discovered rxjs-router tree
      ↓
Query/Cache + form/action dataflows
      ↓
Hono HTTP boundary
      ↓
Bun runtime
```

## Run

The current `rxjs-router` dependency is a sibling `file:` dependency, so the repositories must sit beside one another:

```sh
git clone https://github.com/hansschenker/rxjs-router ../rxjs-router
(cd ../rxjs-router && bun install --production)
bun install
bun run check
bun run dev
```

Then open `http://localhost:3000`.

Current application endpoints include:

```text
GET  /health
GET  /
GET  /about
GET  /counter
GET  /todos
GET  /api/todos
POST /api/actions/todos.create
```

The older `/hello/:name` code remains in `src/examples/routes.tsx` as a typed-routing proof for path-derived params and `href()` generation; it is not part of the generated M06/M07 application route tree.

## Development collaboration

`rxjs-fullstack` is being developed collaboratively by **hansschenker** and **ChatGPT by OpenAI**.

ChatGPT has been the primary AI implementation collaborator for architecture refinement, TypeScript/RxJS implementation, verification, documentation, and repository workflow, while project direction and architectural goals are defined and reviewed by hansschenker.

See [`CONTRIBUTORS.md`](./CONTRIBUTORS.md) for the project contributor list.

## Architectural rule

The project should add only coordination that the underlying technologies do not already provide. RxJS remains visible as the application machine; JSX is view syntax, `rxjs-router` owns routing semantics, Hono owns HTTP, and Bun is a runtime/build adapter rather than framework semantics.
