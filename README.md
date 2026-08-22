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
- **Bun** — reference development runtime and build tool.
- **Node.js / fetch-native edge runtimes** — alternate runtime hosts around the same Web `Request → Response` application boundary.

The central rule is: **RxJS is the application machine; the surrounding technologies remain thin, explicit boundaries.**

This README is the canonical source for the `rxjs-fullstack` project page. Every milestone should therefore document not only what was implemented, but why it exists, what flows through it, where execution starts, how cancellation works, which technology owns each responsibility, and how the milestone is verified.

## Milestone status

```text
M01  TypeScript JSX runtime                         ✅
M02  RxJS DOM bindings                             ✅
M03  Pure HTML renderer + basic SSR               ✅
M04  Hono + Bun server                             ✅
M05  Strongly typed routing + Query/Cache         ✅
M06  File-based route discovery                   ✅
M07  Forms + RxJS server actions                  ✅
M08  SSR Query Prefetch / Client Data Continuity  ✅
M09  Static Site Generation                       ✅
M10  Runtime Adapters                             ✅
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

Hono owns HTTP. Bun is the first reference runtime adapter. `src/server/app.tsx` defines the Web-API application, while the Bun entry supplies the runtime `fetch` host and port.

The server path is:

```text
HTTP request
  ↓
runtime host
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

No framework semantics depend on Bun-specific APIs. M10 later makes that architectural intention executable across multiple runtimes.

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

M07 is the point where `rxjs-fullstack` moves from framework structure into a complete fullstack effect.

Before M07, the Todos example could already fetch cached server data and perform a mutation, but the write path was still an application-specific HTTP workflow. M07 replaces that path with a reusable framework model:

```text
HTML form
   ↓
SubmitEvent
   ↓
RxJS submit dataflow
   ↓
typed ServerActionRef<Input, Output>
   ↓
cold/cancellable HTTP Observable
   ↓
Hono server-action boundary
   ↓
lazy RxJS server execution
   ↓
pure domain validation + operation
   ↓
typed result
   ↓
Query/Cache invalidation
   ↓
refetched view
```

The result is the first end-to-end proof that UI events, concurrency policy, network effects, server execution, and data refresh can all remain one explicit RxJS-oriented architecture without introducing a component framework lifecycle or an eager Promise-based action abstraction.

### The form itself is the event source

The Todos UI declares an ordinary HTML form whose `submit` event is forwarded to an RxJS `Subject<SubmitEvent>`:

```tsx
const submit$ = new Subject<SubmitEvent>();

<form on={{ submit: submit$ }}>
  <input name="title" type="text" required />
  <button type="submit">Add</button>
</form>
```

This matters because the user intent is **submit this form**, not **click this particular button**. Keyboard submission and button submission therefore enter the same source stream.

The DOM renderer remains domain-agnostic. It forwards the event package; application code decides what that event means.

### FormData becomes domain data before the effect

The browser converts the submitting form into a typed domain input before invoking the effect:

```text
SubmitEvent
    ↓
currentTarget: HTMLFormElement
    ↓
FormData(form)
    ↓
raw title string
    ↓
createTodoInput(title)
    ↓
CreateTodoInput
```

After that boundary, the transport moves a typed package. It does not know Todo semantics.

### Submit concurrency policy remains explicit

The central policy is visible as `exhaustMap`:

```text
mergeMap   = allow overlapping submissions
switchMap  = replace with the latest submission
concatMap  = queue submissions
exhaustMap = ignore submissions while one is active
```

For Todo creation, M07 chooses:

```text
submit     A────B────C────────────D
           │    ×    ×             │
           ▼                       ▼
action     [ save A ........ ]     [ save D ... ]

policy     exhaustMap = ignore while busy
```

The server-action API itself does not hide or choose this temporal policy.

### Shared server-action references are contracts

The client and server share an action identity and TypeScript input/output types without making browser code import server implementation details:

```ts
export const createTodoAction = defineServerAction<CreateTodoInput, Todo>(
  'todos.create',
);
```

That declaration provides:

```text
action identity     todos.create
input type          CreateTodoInput
output type         Todo
```

It does not own persistence, Hono, query invalidation, validation implementation, or concurrency policy.

### Client action execution is cold and cancellable

`invokeServerAction$()` returns an Observable backed by `fromFetch`:

```text
Observable exists
      │
      │ no subscription
      ▼
nothing happens

subscribe
      ↓
HTTP POST starts
      ↓
response arrives
      ↓
Todo emitted
      ↓
complete
```

Because the request is owned by the Observable subscription, view teardown can propagate cancellation to the active HTTP effect.

### Server action execution is also lazy RxJS

The generic server boundary separates runtime parsing and effect execution:

```text
raw unknown JSON
      ↓
executeServerAction$()
      ↓
defer(...)
      ↓
handler.parse(rawInput)
      ↓
typed TInput
      ↓
handler.run(input, context)
      ↓
Observable<TOutput>
```

The request `AbortSignal` is available to server action handlers so later database or network effects can participate in the same cancellation boundary.

### Query/Cache owns the read side after a write

The action does not secretly mutate browser state. The application explicitly invalidates the query after a successful create:

```text
createTodo$(input)
      ↓
Todo emitted
      ↓
invalidateQueries(['todos'])
      ↓
active GET /api/todos refetch
      ↓
query result emits
      ↓
list$ renders latest data
```

This keeps action effects and cached reads separate but coordinated.

### M07 source map

```text
src/domain/todos.ts
  Todo / CreateTodoInput types and parsers

src/actions/action.ts
  ServerActionRef, action href, client invocation

src/actions/todos.ts
  shared createTodoAction identity

src/queries/todos.ts
  todosQuery + createTodo$ browser action

src/examples/todos.tsx
  form source, exhaustMap policy, invalidation

src/server/action.ts
  generic lazy server-action execution

src/server/api.ts
  HTTP registration

src/server/todos-store.ts
  Todo domain storage proof
```

### M07 verification

The executable verifier checks laziness, one execution per subscription, HTTP status behavior, runtime input validation, visibility of created data through the query read path, removal of the old ad-hoc mutation endpoint, typechecking, and browser bundling.

The larger result is: **server actions are not a second execution model beside RxJS; they are effects that participate in the existing RxJS machine.**

## M08 — SSR Query Prefetch / Client Data Continuity

M08 closes the read-side discontinuity that remained after M05–M07.

Before M08, the server rendered a loading shell and the browser started the query from an empty cache. M08 changes that to one query lifecycle across the HTML boundary:

```text
HTTP GET /todos
      ↓
request-scoped QueryClient
      ↓
rxjs-router loader
      ↓
queryClient.query$(todosQuery)
      ↓
in-process GET /api/todos
      ↓
readonly Todo[]
      ↓
Query/Cache
      ├──────────────► static SSR Todo snapshot
      │
      └──────────────► dehydrate()
                         ↓
                  application/json bootstrap state
                         ↓
                       HTML
                         ↓
browser entry reads state before mount
      ↓
hydrate(queryClient, state)
      ↓
TodoApp subscribes to the same query key
      ↓
fresh cached Todos emit immediately
```

The important result is **continuity of the same query state across the server/browser boundary**.

### Request-scoped server QueryClient

Every page request receives a new QueryClient. Query state is isolated between requests unless an application later introduces an explicit shared server cache.

The QueryClient and fetch boundary travel through `rxjs-router` context, which keeps route modules responsible for declaring their own data requirements rather than adding route-specific branches to Hono.

### The route controls query lifetime

The Todos loader subscribes to its query and connects the route request `AbortSignal` using `takeUntil(...)`.

```text
route request signal ───────────────┐
                                    │
query$ ── loading ── data ── ...    │
  │                                 │
  └──────── takeUntil(abort) ◄──────┘
```

The request owns the lifetime of the server read.

### Server and browser share one query identity

The query remains `['todos']` on both sides. `createTodosQuery(fetcher)` makes only the transport replaceable; query identity, result type, and cache semantics remain unchanged.

The server uses an in-process Hono fetch adapter, while the browser uses normal Web `fetch`.

### SSR still renders resolved values, not Observables

M03's renderer rule remains intact:

```text
query$ subscription
      ↓
readonly Todo[]
      ↓
TodoSnapshot
      ↓
plain ViewChild
      ↓
renderToString()
```

M08 does not teach `renderToString()` how to subscribe.

### Dehydrated state travels as data

Successful Query/Cache state is serialized into:

```html
<script id="rxjs-query-state" type="application/json">...</script>
```

The JSON is HTML-safe escaped. The document contains data, not embedded query logic.

### Browser cache restoration happens before subscription

The bootstrap ordering is deliberate:

```text
read #rxjs-query-state
   ↓
JSON.parse
   ↓
hydrate(queryClient, state)
   ↓
mount(TodoApp)
   ↓
TodoApp subscribes
```

Hydrating first prevents an empty browser cache from racing ahead with another cold fetch.

### Freshness prevents the immediate duplicate read

Hydration alone is insufficient when `staleTime` is zero. M08 therefore makes the Todos freshness policy explicit:

```ts
staleTime: 30_000
```

```text
server fetch       ● data resolved
                   │
HTML response      │──── dehydrated state ────►
                   │
browser hydrate    ● same data restored
                   │<------ 30s fresh ------->│
client subscribe   ● cached data emits
                   │
                   └── no immediate GET /api/todos
```

Normal Query/Cache staleness and refetch behavior resumes after the freshness window.

### M08 is Query/Cache hydration, not DOM hydration

M08 guarantees:

```text
server query state ──► browser query state
```

It does not yet claim:

```text
server DOM nodes ──► attach bindings in place
```

The DOM renderer may still replace the static SSR region when mounting the live browser view. Keeping these two hydration problems separate makes the architecture easier to reason about.

### M08 source map

```text
src/queries/todos.ts
  shared query identity + freshness policy

src/server/route-context.ts
  QueryClient + fetch context

src/routes/todos.tsx
  SSR query subscription + request cancellation

src/examples/todos.tsx
  shared list, static snapshot, live TodoApp

src/query/ssr.ts
  bootstrap state helper

src/render/html.ts
  safe application/json serialization

src/server/app.tsx
  request boundary and dehydrated state delivery

src/examples/todos-client.tsx
  cache restore before mount
```

### M08 verification

The verifier proves that SSR contains actual Todo data instead of a loading placeholder, dehydrated query state is present, a server query executes once, browser hydration restores that value, and a fresh hydrated client query performs zero duplicate query executions.

The larger result is: **SSR may resolve the first value, but Query/Cache remains the state machine that owns the read across the boundary.**

## M09 — Static Site Generation

M09 proves that request-time SSR and build-time static generation do not need separate application models.

The framework already had the complete page machine:

```text
route match
   ↓
route loaders
   ↓
Query/Cache where needed
   ↓
resolved PageData
   ↓
JSX ViewChild
   ↓
pure renderToString()
   ↓
HTML document
```

M09 keeps that machine and changes only **when** it executes and **what consumes the resulting HTML**.

```text
HTTP request                    build command
    ↓                               ↓
renderRouteDocument()           pathname
    ↓                               ↓
HTML                           renderRouteDocument()
    ↓                               ↓
Hono Response                  HTML
                                    ↓
                               static index.html
```

The central M09 rule is: **SSG is not a new renderer. It is the existing route-document renderer executed during the build.**

### Shared route-document rendering

`src/render/page.ts` owns the reusable page resolution operation:

```text
routes + Request + fetch boundary
            ↓
request/build-scoped QueryClient
            ↓
resolveRequest()
            ↓
route loaders
            ↓
resolved PageData
            ↓
renderToString(page.view)
            ↓
dehydrate(QueryClient)
            ↓
renderDocument()
            ↓
RouteDocumentResult
```

Hono translates that result into an HTTP response. SSG translates the same successful page result into a file.

### Static paths come from the generated route tree

M09 does not add a second route manifest. `collectStaticPathnames()` normalizes the M06 generated router tree and derives concrete `fullPath` values.

The current set is:

```text
/
/about
/counter
/todos
```

Parameterized paths such as `/posts/$slug` are excluded until the application explicitly supplies build-time parameter values. The generator never guesses domain data.

### Static URL mapping

M09 emits directory-index output suitable for ordinary static hosts:

```text
/          → dist/static/index.html
/about     → dist/static/about/index.html
/counter   → dist/static/counter/index.html
/todos     → dist/static/todos/index.html
```

### Build-time Query/Cache reuse

The `/todos` static page reuses the M08 query path:

```text
renderStaticPage('/todos')
      ↓
renderRouteDocument()
      ↓
Todos route loader
      ↓
build-scoped QueryClient
      ↓
GET /api/todos through supplied fetch boundary
      ↓
readonly Todo[]
      ↓
TodoSnapshot
      ↓
dehydrate(QueryClient)
      ↓
HTML + query bootstrap
      ↓
dist/static/todos/index.html
```

Each generated page receives its own QueryClient, preserving the request-isolation principle at build time.

### SSG preserves the pure HTML boundary

`renderToString()` still never subscribes. All build-time data work resolves before the renderer receives the view.

### SSR/SSG equivalence becomes testable

Deterministic pages such as `/about` are compared byte-for-byte between request-time SSR and build-time SSG. Query-backed pages are checked semantically because dehydration timestamps can differ between separate executions.

### Build command

```sh
bun run build:static
```

The generator discovers static paths, clears `dist/static`, renders each pathname, creates parent directories, and writes `index.html` files.

### M09 source map

```text
src/render/page.ts
  shared route/data/query/HTML execution

src/server/app.tsx
  HTTP translation

src/ssg/static.ts
  path discovery, output mapping, static rendering

scripts/generate-static.ts
  build entry point and file writes

scripts/verify-static.ts
  physical artifact verification

scripts/verify.tsx
  in-memory SSG semantics

package.json
  build:static + verify:static + check integration
```

### M09 verification

The complete gate verifies static path discovery, parameterized-route exclusion, output mapping, `/about` SSR/SSG equality, `/todos` prefetch and dehydrated state, physical HTML artifacts, and compatibility with the browser bundles.

The larger result is: **SSR and SSG are execution-time policies around the same RxJS Fullstack page machine.**

## M10 — Runtime Adapters

M10 proves that runtime choice is outside the application machine.

By M09 the framework already had a runtime-neutral page and HTTP architecture. The remaining runtime-specific code was simply the process that hosted Hono. M10 makes that boundary explicit and verifies it across three hosting shapes:

```text
                         ┌── Bun server
                         │
Web Request ─► app.fetch ├── Cloudflare-style Worker
                         │
                         └── Node.js bridge
                               ↓
Web Response
```

Everything inside `app.fetch` remains the same:

```text
Request
  ↓
Hono routes / API
  ↓
rxjs-router
  ↓
RxJS Query/Cache + server actions
  ↓
SSR / route-document rendering
  ↓
Response
```

The central M10 rule is: **runtime adapters host the application; they do not redefine the application.**

### The portable application boundary is Web Request → Response

M10 introduces `src/runtime/fetch.ts`:

```ts
export const fetchHandler = app.fetch;
```

That line is intentionally small. It represents the complete runtime-neutral contract:

```text
(Request) → Response | Promise<Response>
```

Routes do not receive a Bun request type, a Node `IncomingMessage`, or a Cloudflare-specific event. Hono continues to expose Web Platform request/response values to the application.

This gives the framework one portable server boundary:

```text
runtime-specific incoming request
            ↓
runtime host / bridge
            ↓
Web Request
            ↓
fetchHandler
            ↓
Web Response
            ↓
runtime-specific outgoing transport
```

Only the outermost arrows are runtime-specific.

### Bun is now an explicit adapter rather than an implicit framework dependency

M04 introduced Bun as the first runtime. M10 moves its hosting policy into:

```text
src/runtime/bun.ts
```

The adapter exposes ordinary Bun server options:

```ts
{
  port: 3000,
  fetch: fetchHandler,
}
```

The default port remains `3000`, preserving the original development workflow.

The older `src/server/bun.ts` path remains as a compatibility re-export so M10 does not break the M04 entry point merely to reorganize runtime ownership.

Conceptually:

```text
Bun
 ↓
createBunServerOptions()
 ↓
fetchHandler
 ↓
RxJS Fullstack application
```

Bun therefore remains a convenient development runtime and the build tool used by the project, but it is no longer the only demonstrated server host.

### Fetch-native edge runtimes need almost no adapter

A runtime that already speaks the Web fetch contract does not require an HTTP translation layer.

M10 proves that with a Cloudflare Workers Module Worker shape:

```ts
export const cloudflareWorker = {
  fetch: fetchHandler,
};
```

The flow is:

```text
Cloudflare-style fetch event
       ↓
worker.fetch(Request)
       ↓
fetchHandler(Request)
       ↓
Hono / RxJS Fullstack
       ↓
Response
```

The important point is not Cloudflare-specific functionality. It is the opposite: **no Cloudflare-specific application functionality is needed** for the core HTTP path.

The worker entry is built with a browser/edge target. That build is an architectural test: if Node-only modules accidentally leak into the fetch-native runtime dependency graph, the worker build should expose the portability violation.

### Node.js uses a transport bridge, not a second application API

Node's traditional HTTP server API is not itself the Web fetch server contract, so M10 uses Hono's official Node adapter:

```text
@hono/node-server
```

`src/runtime/node-adapter.ts` performs only this translation:

```text
Node HTTP server
      ↓
@hono/node-server
      ↓
fetchHandler
      ↓
Web Response
      ↓
Node HTTP response
```

The adapter never calls route loaders directly and never knows about QueryClient, server actions, JSX, SSR, or SSG.

That separation is significant. A Node deployment does not become a parallel implementation of `rxjs-fullstack`; it is simply another host around the same application function.

### The executable Node entry owns process policy

`src/runtime/node.ts` is the process-level Node entry point.

It owns runtime concerns that genuinely belong at the process boundary:

- reading `PORT`,
- validating the configured port,
- starting the Node server,
- logging the listening address,
- handling `SIGINT` and `SIGTERM`,
- closing the server during shutdown.

Those concerns do not leak into Hono routes or RxJS application pipelines.

The default remains:

```text
port = 3000
```

and deployments can override it through:

```sh
PORT=8080 ...
```

### Runtime choice does not change RxJS execution semantics

M10 introduces no new Observable type, scheduler, cancellation mechanism, query implementation, or action implementation.

For example, a browser action still flows as:

```text
subscribe
   ↓
fromFetch
   ↓
HTTP request
   ↓
runtime host
   ↓
Hono server-action route
   ↓
executeServerAction$()
   ↓
Observable handler
```

Whether the server process is hosted by Bun or Node does not alter the `exhaustMap`, `concatMap`, unsubscription, query invalidation, or handler Observable semantics chosen by application code.

Likewise, SSR remains:

```text
Request
  ↓
runtime adapter
  ↓
Hono
  ↓
renderRouteDocument()
  ↓
route loader / QueryClient
  ↓
renderToString()
  ↓
Response
```

The runtime adapter does not insert a new lifecycle into the middle of the RxJS machine.

### M09 and M10 define two independent outer policies

M09 separated **when a page is rendered**:

```text
request time → SSR
build time   → SSG
```

M10 separates **what hosts request-time execution**:

```text
Bun        → fetch-native host
Cloudflare → fetch-native host
Node       → Node HTTP bridge → fetch handler
```

These axes are independent:

```text
                         execution time
                    request            build
                       │                 │
                       ▼                 ▼
application      renderRouteDocument   renderRouteDocument
                       │                 │
                       ▼                 ▼
consumer          Web Response       static HTML file
                       │
             ┌─────────┼─────────┐
             ▼         ▼         ▼
            Bun      Node      Worker
```

This is useful because deployment concerns do not need to infect rendering or dataflow semantics.

### Runtime bundles are part of the architecture check

M10 adds two explicit server build products:

```text
dist/runtime/node.js

dist/runtime/cloudflare.js
```

The Node entry is built with a Node target. The Worker entry is built with a browser/edge target.

This gives the repository a practical dependency-boundary check:

```text
Node-only dependency
       │
       ├── allowed in Node adapter graph
       │
       └── must not leak into worker graph
```

The application itself remains shared underneath both builds.

### The Node proof runs under the actual node executable

M10 does not consider a successful TypeScript build sufficient proof of Node portability.

`scripts/verify-runtimes.ts` launches:

```text
node dist/runtime/node.js
```

as a child process on an isolated test port.

The verifier then makes real HTTP requests to that process:

```text
Node process
   ↓
GET /health
   ↓
200 {"ok":true}

Node process
   ↓
GET /about
   ↓
SSR HTML
```

It compares the Node `/about` HTML byte-for-byte with the output obtained through the runtime-neutral `fetchHandler`.

That assertion is important:

```text
Node transport result == fetch-native application result
```

The Node adapter is therefore tested as a transparent transport bridge rather than trusted merely because it compiles.

### Fetch-native adapters are compared directly

The same runtime verifier calls:

```text
fetchHandler
bunRuntime.fetch
cloudflareRuntime.fetch
```

with Web `Request` values.

It checks that the adapters preserve the same application responses, including deterministic SSR output for `/about`.

The invariant is:

```text
same Request
    ↓
different runtime host
    ↓
same application semantics
    ↓
equivalent Response
```

### M10 source map

```text
src/runtime/fetch.ts
  runtime-neutral app.fetch export
  canonical Web Request → Response boundary

src/runtime/bun.ts
  Bun port + fetch server options

src/runtime/cloudflare.ts
  fetch-native Module Worker shape

src/runtime/node-adapter.ts
  @hono/node-server bridge

src/runtime/node.ts
  executable Node process entry
  PORT + shutdown policy

src/server/bun.ts
  M04 compatibility re-export

scripts/verify-runtimes.ts
  fetch-native adapter comparison
  real Node child-process smoke test
  SSR response equivalence

package.json
  start:bun / start:node
  build:node / build:worker
  verify:runtimes
  runtime checks in the complete acceptance gate
```

### M10 verification

M10 is verified at several levels.

TypeScript checks that the runtime boundaries and adapters agree structurally.

The build gate proves that:

- the Node runtime dependency graph bundles for a Node target,
- the Cloudflare-style runtime dependency graph bundles for a browser/edge target,
- the existing browser clients still bundle independently.

The runtime verifier proves that:

- the shared `fetchHandler` serves `/health`,
- the Bun adapter exposes that same handler,
- the Cloudflare-style adapter exposes that same handler,
- fetch-native adapters produce equivalent application responses,
- deterministic `/about` SSR is unchanged by the Worker wrapper,
- `dist/runtime/node.js` starts under the actual `node` executable,
- the Node process serves `/health`,
- the Node process serves SSR routes,
- Node `/about` HTML is byte-for-byte identical to the runtime-neutral fetch result,
- the Node process can be terminated cleanly after verification.

The complete acceptance pipeline is now conceptually:

```text
route generation
      ↓
strict TypeScript
      ↓
M01-M10 executable verification
      ↓
static site generation + verification
      ↓
Node runtime build
      ↓
edge/Worker runtime build
      ↓
actual runtime adapter verification
      ↓
browser client bundles
```

### What M10 establishes

M10 turns the M04 runtime intention into an executable architectural invariant:

```text
                           ┌── Bun
                           │
RxJS Fullstack app.fetch ──┼── fetch-native edge runtime
                           │
                           └── Node HTTP bridge
```

The framework does not ask application code which runtime it is running on in order to route, query, render, or execute actions.

Instead:

```text
runtime chooses hosting policy
application chooses dataflow policy
```

That is the larger M10 result: **Bun, Node.js, and fetch-native edge runtimes are hosts around the same RxJS Fullstack machine, not separate versions of the framework.**

## What M01–M10 establish

```text
M01  JSX is a typed description of a view.
M02  Browser execution is owned by RxJS Subscriptions.
M03  Server rendering is a pure step inside an RxJS dataflow.
M04  HTTP and the first runtime host remain thin boundaries.
M05  Routing and Query/Cache provide application infrastructure.
M06  Route modules are discovered without central registration.
M07  Forms drive typed, lazy, cancellable RxJS server actions.
M08  Server-resolved query state continues into browser Query/Cache.
M09  The same page machine can execute at build time to produce static HTML.
M10  Multiple runtimes host the same Web Request → Response application.
```

The current architecture is:

```text
TypeScript JSX
      ↓
framework ViewChild
      ↓
file-discovered rxjs-router tree
      ↓
route loaders + RxJS Query/Cache execution
      ↓
resolved PageData
      ↓
shared route-document renderer
      ├──────── build time ──────────► dist/static/**/index.html
      │                               + dehydrated Query/Cache state
      │
      └──────── request time ────────► Hono app.fetch
                                         │
                            ┌────────────┼────────────┐
                            ▼            ▼            ▼
                           Bun         Node.js     fetch-native
                                        │          edge runtime
                                        ▼
                               @hono/node-server

browser side
      ↓
Query/Cache hydration + DOM bindings + form/action dataflows
      ↓
RxJS Subscription-owned execution
```

## Run

The current `rxjs-router` dependency is a sibling `file:` dependency, so the repositories must sit beside one another:

```sh
git clone https://github.com/hansschenker/rxjs-router ../rxjs-router
(cd ../rxjs-router && bun install --production)
bun install
bun run check
```

### Bun development runtime

```sh
bun run dev
```

or explicitly:

```sh
bun run dev:bun
bun run start:bun
```

Then open `http://localhost:3000`.

### Node.js runtime

```sh
bun run start:node
```

This generates routes, builds `dist/runtime/node.js`, and launches it under Node.js. `PORT` can override the default `3000` port.

### Static site generation

```sh
bun run build:static
```

Generated pages are written under `dist/static/`.

### Runtime builds and verification

```sh
bun run build:node
bun run build:worker
bun run verify:runtimes
```

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

The older `/hello/:name` code remains in `src/examples/routes.tsx` as a typed-routing proof for path-derived params and `href()` generation; it is not part of the generated M06–M10 application route tree.

## Development collaboration

`rxjs-fullstack` is being developed collaboratively by **hansschenker** and **ChatGPT by OpenAI**.

ChatGPT has been the primary AI implementation collaborator for architecture refinement, TypeScript/RxJS implementation, verification, documentation, and repository workflow, while project direction and architectural goals are defined and reviewed by hansschenker.

See [`CONTRIBUTORS.md`](./CONTRIBUTORS.md) for the project contributor list.

## Architectural rule

The project should add only coordination that the underlying technologies do not already provide. RxJS remains visible as the application machine; JSX is view syntax, `rxjs-router` owns routing semantics, Hono owns HTTP, runtime adapters own hosting, and Bun remains the reference development/build tool rather than framework semantics.
