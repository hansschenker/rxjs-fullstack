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

Before M07, the Todos example could already fetch cached server data and perform a mutation, but the write path was still an application-specific HTTP workflow: a button click triggered code that queried the DOM for an input element and posted directly to `POST /api/todos`.

M07 replaces that path with a reusable framework model:

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

The Todos UI now declares an ordinary HTML form whose `submit` event is forwarded to an RxJS `Subject<SubmitEvent>`:

```tsx
const submit$ = new Subject<SubmitEvent>();

<form on={{ submit: submit$ }}>
  <input
    name="title"
    type="text"
    placeholder="What needs doing?"
    required
  />
  <button type="submit">Add</button>
</form>
```

This matters because the user intent is **submit this form**, not **click this particular button**. Keyboard submission and button submission therefore enter the same source stream.

The DOM renderer still knows nothing about Todos or forms. Its responsibility remains the M02 rule: take a browser event and forward that event package to an `Observer`. The application decides what the event means.

The browser-default navigation is stopped by an ordinary function used inside the pipeline:

```ts
const preventFormNavigation = (event: SubmitEvent): void => {
  event.preventDefault();
};
```

The operator remains visible:

```ts
submit$.pipe(
  tap(preventFormNavigation),
  ...
);
```

This follows the project's FP/RxJS rule: **name the domain or application function; do not rename the RxJS mechanism around it.**

### FormData is converted into domain data before the effect

The form element is available as `event.currentTarget`. M07 reads `FormData` from that exact submitting form instead of searching global DOM state.

Conceptually:

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

`createTodoInput()` lives in `src/domain/todos.ts`. It trims the title and returns a typed `CreateTodoInput` only for a non-empty value.

The important boundary is:

```text
browser representation      domain representation
FormData / string      →     CreateTodoInput
```

After that conversion, the server-action transport moves a typed package. It does not care what a Todo title means.

### The submit concurrency policy is explicit

The central browser pipeline is:

```ts
const status$ = submit$.pipe(
  tap(preventFormNavigation),
  exhaustMap((event) => {
    const submission = readTodoSubmission(event);
    // ... invoke action, invalidate query, reset form
  }),
  startWith(''),
);
```

`exhaustMap` is deliberately visible because it states the form's concurrency policy:

> While one Todo creation is in flight, ignore additional submissions.

In practical terms:

```text
time ─────────────────────────────────────────►

submit     A────B────C────────────D
           │    ×    ×             │
           │                       │
           ▼                       ▼
action     [ save A ........ ]     [ save D ... ]

policy     exhaustMap = ignore while busy
```

Nothing in the server-action API chooses this for the application. Another form can choose a different policy without changing the transport:

```text
mergeMap   = allow overlapping submissions
switchMap  = cancel/replace with the latest submission
concatMap  = queue submissions
exhaustMap = ignore submissions while one is active
```

This is a central design decision for `rxjs-fullstack`: **the effect describes how to execute one request; the RxJS pipeline describes how multiple requests relate over time.**

### Shared server-action references are contracts, not implementations

The client and server need to agree that an action exists and what TypeScript values it carries, but the browser must not import server implementation code.

M07 therefore introduces `ServerActionRef<TInput, TOutput>`.

The Todo action declaration is intentionally small:

```ts
export const createTodoAction = defineServerAction<CreateTodoInput, Todo>(
  'todos.create',
);
```

It provides three things:

```text
action identity     todos.create
input type          CreateTodoInput
output type         Todo
```

It does **not** contain:

- Todo persistence,
- validation implementation,
- Hono code,
- server-only dependencies,
- query invalidation,
- concurrency policy.

This makes the action reference safe to share with browser code while keeping the server implementation physically and conceptually separate.

The shared primitives live in:

```text
src/actions/action.ts
src/actions/todos.ts
```

### Client action execution is cold and cancellable

The browser invokes the action through:

```ts
invokeServerAction$(createTodoAction, input)
```

`invokeServerAction$()` returns an RxJS Observable backed by `fromFetch`.

That gives the client action the same execution model as the rest of the framework:

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

The action URL is derived from the action identity:

```text
todos.create
     ↓
/api/actions/todos.create
```

The request body contains the typed input serialized as JSON.

This transport remains intentionally small. It does not know about forms, Todo state, `exhaustMap`, or Query/Cache. It performs one job:

```text
ServerActionRef<Input, Output> + Input
                ↓
        Observable<Output>
```

### Cancellation follows the RxJS Subscription

Because the action request is a `fromFetch` Observable, unsubscription aborts the underlying request.

The cancellation chain is therefore explicit:

```text
mount(TodoApp)
    ↓
view Subscription
    ↓
status$ subscription
    ↓
active createTodo$ subscription
    ↓
fromFetch request
```

If the mounted view is torn down:

```text
view lifetime.unsubscribe()
        ↓
status$ unsubscribes
        ↓
active inner action unsubscribes
        ↓
fromFetch aborts HTTP request
```

M07 therefore does not introduce a second cancellation system. It extends the M02 lifetime rule across the network boundary: **the RxJS Subscription remains the owner of browser work.**

### The server action is also a lazy RxJS dataflow

The server side mirrors the browser-side execution model.

`registerServerAction()` connects a shared `ServerActionRef` to a server-only handler. The handler contract separates input parsing from execution:

```ts
interface ServerActionHandler<TInput, TOutput> {
  parse(value: unknown): TInput;
  run(
    input: TInput,
    context: ServerActionContext,
  ): Observable<TOutput>;
  successStatus?: number;
}
```

The HTTP adapter first obtains raw JSON. The typed server execution is then described by `executeServerAction$()`:

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

Both parsing and handler invocation are inside `defer()`. That means they do not run merely because the Observable was constructed.

At the HTTP boundary, Hono consumes that lazy description with `firstValueFrom()` and converts the result into a JSON `Response`.

```text
Hono owns HTTP
       ↓
firstValueFrom(executeServerAction$(...))
       ↓
RxJS owns action execution
       ↓
Hono owns HTTP response
```

This is the same boundary pattern already established for server rendering: asynchronous execution happens before the pure boundary consumes its resolved value.

### Raw input is validated again on the server

TypeScript types disappear at the network boundary, so a typed client declaration is not sufficient runtime validation.

The server receives `unknown` and calls the domain parser:

```ts
parseCreateTodoInput(value)
```

The flow is:

```text
JSON payload
  unknown
    ↓
parseCreateTodoInput
    ↓
CreateTodoInput | undefined
    ↓
valid input ──────────────► run action
invalid input ────────────► HTTP 400
```

This means the action reference gives compile-time agreement while the domain parser gives runtime trust at the server boundary.

The validation rule itself still lives in the domain layer, not in Hono and not in the generic action adapter.

### Server context carries request lifetime information

A server action receives:

```ts
interface ServerActionContext {
  request: Request;
  signal: AbortSignal;
}
```

The Todo action checks `signal.aborted` before performing the in-memory write. This establishes the first server-action cancellation hook and leaves room for later database or network effects to consume the same request signal.

M07 does not yet claim that every possible server-side side effect is automatically cancellable. What it establishes is the correct architecture: **the request AbortSignal is available to the RxJS server action instead of being hidden by the HTTP adapter.**

### Todo business logic remains outside the action framework

The server-specific Todo store lives in `src/server/todos-store.ts`. The generic action adapter does not know its structure.

The Todo action performs this conceptual work:

```text
CreateTodoInput
      ↓
addTodo(input)
      ↓
Todo
```

The RxJS layer merely lifts that operation into a lazy execution description:

```text
defer(() => of(addTodo(input)))
```

This preserves the project's rule:

> **Pure/domain logic inside; RxJS and HTTP plumbing outside.**

The domain can later change from an in-memory array to a database without changing the form source, the `exhaustMap` policy, the action reference, or the basic action transport.

### Query/Cache owns the read side after a successful write

M07 deliberately does not make the server action secretly update browser state.

The action returns the created `Todo`. The application then explicitly invalidates the existing Todos query:

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

The relevant pipeline uses `concatMap` because the status should not become `Saved.` until invalidation/refetch work has completed:

```ts
createTodo$(submission.input).pipe(
  concatMap(() =>
    queryClient.invalidateQueries({ queryKey: todosQuery.queryKey }),
  ),
  tap(() => submission.form.reset()),
  map(() => 'Saved.'),
  startWith('Saving...'),
);
```

This gives each mechanism one responsibility:

| Concern | Owner |
| --- | --- |
| form event | browser / JSX Observer binding |
| temporal submit policy | `exhaustMap` |
| domain input creation | `createTodoInput()` |
| client action transport | `invokeServerAction$()` / `fromFetch` |
| HTTP routing and response | Hono |
| runtime input validation | `parseCreateTodoInput()` |
| Todo creation | `addTodo()` |
| server execution | `executeServerAction$()` + handler Observable |
| cached server reads | Query/Cache |
| post-write refresh | explicit `invalidateQueries()` |
| browser lifetime/cancellation | RxJS `Subscription` |

No single layer becomes a hidden mini-framework.

### The M07 Todo write path versus the read path

M07 now gives the Todos feature two intentionally different fullstack paths.

Read path:

```text
TodoApp subscription
      ↓
queryClient.query$(todosQuery)
      ↓
GET /api/todos
      ↓
readonly Todo[]
      ↓
Query/Cache
      ↓
list$ view
```

Write path:

```text
<form submit>
      ↓
submit$
      ↓
exhaustMap
      ↓
createTodo$(CreateTodoInput)
      ↓
POST /api/actions/todos.create
      ↓
server action
      ↓
Todo
      ↓
invalidate ['todos']
      ↓
read path refetches
```

This separation is useful: **actions perform effects; queries describe cached server reads.** They coordinate explicitly rather than being fused into one opaque abstraction.

### M07 failure behavior is explicit

The action boundary distinguishes several failure classes:

```text
malformed JSON
    ↓
HTTP 400

valid JSON shape but invalid domain input
    ↓
ServerActionInputError
    ↓
HTTP 400

unexpected server handler failure
    ↓
HTTP 500

non-2xx browser response
    ↓
ServerActionRequestError
    ↓
Observable error
    ↓
catchError in Todo pipeline
    ↓
"Failed to save."
```

The error therefore travels through the Observable error channel until the application decides how to turn it into view state.

### M07 source map

The milestone is intentionally spread across small responsibility-focused files:

```text
src/domain/todos.ts
  Todo and CreateTodoInput types
  createTodoInput()
  parseCreateTodoInput()

src/actions/action.ts
  ServerActionRef<Input, Output>
  defineServerAction()
  serverActionHref()
  invokeServerAction$()
  ServerActionRequestError

src/actions/todos.ts
  shared createTodoAction reference

src/queries/todos.ts
  todosQuery read definition
  createTodo$ client action invocation

src/examples/todos.tsx
  form source
  SubmitEvent → FormData → CreateTodoInput
  exhaustMap submit policy
  Query/Cache invalidation
  status rendering

src/server/action.ts
  ServerActionHandler contract
  executeServerAction$()
  registerServerAction()
  HTTP/error translation

src/server/api.ts
  GET /todos
  createTodoAction server registration

src/server/todos-store.ts
  in-memory Todo state and addTodo()
```

This file layout is part of the design. Shared action identity, browser transport, generic server adapter, domain rules, application orchestration, and server storage do not collapse into one module.

### M07 verification

`scripts/verify.tsx` treats the milestone as an executable architectural specification. It checks that:

- server-action input parsing does not run before subscription,
- the server handler does not run before subscription,
- one subscription executes the action exactly once,
- valid Todo action input returns HTTP `201`,
- the returned object contains the created Todo,
- created data becomes visible through the existing `GET /api/todos` read path,
- empty/invalid Todo input returns HTTP `400`,
- the old ad-hoc `POST /api/todos` mutation endpoint is no longer the write path,
- the browser examples still typecheck and bundle successfully.

The milestone is therefore not considered complete merely because the Todo UI works. The verification also protects the intended execution semantics: laziness, typed boundaries, HTTP behavior, and separation of the old mutation route from the new server-action architecture.

### What M07 establishes

M07 adds one important capability, but more importantly it establishes a reusable execution pattern for later fullstack features:

```text
source event
    ↓
plain function extracts domain value
    ↓
RxJS operator chooses temporal policy
    ↓
cold effect Observable
    ↓
server RxJS dataflow
    ↓
domain operation
    ↓
result / error
    ↓
explicit state or cache update
```

A future login form, checkout command, settings save, file metadata update, or database mutation can use the same machine while changing only the domain packages and the chosen concurrency policy.

That is the larger M07 result: **server actions are not a new execution model added beside RxJS; they are one more effect that participates in the existing RxJS machine.**

## M08 — SSR Query Prefetch / Client Data Continuity

M08 closes the read-side discontinuity that remained after M05–M07.

Before M08, `/todos` had two separate starts:

```text
server request                     browser mount
     ↓                                  ↓
SSR route                           TodoApp subscribes
     ↓                                  ↓
"Loading todos..."                 Query/Cache is empty
                                        ↓
                                   GET /api/todos
                                        ↓
                                   render Todos
```

The server knew how to render the page shell, and the browser knew how to fetch Todos, but server-resolved data was not carried across the HTML boundary. The browser therefore had to cold-start the same read again.

M08 changes that flow to:

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

The important result is not merely that the server can fetch Todos. The important result is **continuity of the same query state across the server/browser boundary**.

### The QueryClient is request-scoped on the server

The server must never reuse one application-wide QueryClient across users or requests. M08 therefore creates a new QueryClient inside each Hono page request:

```ts
const queryClient = new QueryClient();
```

That client is passed into `rxjs-router` through its explicit route context:

```ts
resolveRequest({
  routes,
  request,
  context: {
    queryClient,
    fetch: routeFetch,
  },
});
```

This preserves the route architecture established in M06. Hono does not gain a special `if (pathname === '/todos')` prefetch branch. The route loader declares the data it needs; Hono only supplies request infrastructure.

Request isolation is therefore:

```text
request A ──► QueryClient A ──► dehydrate A ──► response A
request B ──► QueryClient B ──► dehydrate B ──► response B
```

No query state crosses between requests unless an application later introduces an explicit shared server cache.

### The Todos route owns its SSR query requirement

`src/routes/todos.tsx` now uses the QueryClient from router context while resolving the page.

The server loader subscribes to:

```ts
context.queryClient.query$(createTodosQuery(context.fetch))
```

and waits until the query has either data or an error before creating the pure SSR view.

The route request `AbortSignal` is connected with `takeUntil(...)`. If the request is cancelled while the query is active, the route subscription is torn down rather than leaving a detached page-read subscription running.

Conceptually:

```text
route request signal ───────────────┐
                                    │
query$ ── loading ── data ── ...    │
  │                                 │
  └──────── takeUntil(abort) ◄──────┘
```

The request controls the lifetime of the server read.

### Server and browser use the same query identity

M08 keeps the existing query key:

```ts
['todos']
```

`createTodosQuery(fetcher)` makes only the transport replaceable. The browser uses the normal Web `fetch`; the server receives an in-process Hono fetch adapter.

The query contract remains:

```text
query key        ['todos']
result           readonly Todo[]
HTTP contract    GET /api/todos
```

The server adapter resolves `/api/todos` through the same Hono application without performing a real network round-trip. This is important because M08 does not introduce a second Todo read implementation just for SSR.

The transport can change; the query identity and data package do not.

### SSR renders resolved data, not an Observable

M03's renderer rule remains unchanged: `renderToString()` never subscribes.

M08 resolves the query before rendering and then builds a static `TodoSnapshot` from the resulting `readonly Todo[]`:

```text
query$ subscription
      ↓
readonly Todo[]
      ↓
TodoSnapshot
      ↓
ViewChild containing plain values
      ↓
renderToString()
```

The SSR renderer still receives no live Observable child.

This means M08 extends SSR without weakening the M03 boundary. Asynchronous execution remains outside the pure HTML renderer.

### Query state is dehydrated into the HTML document

After routing has finished, the request-scoped QueryClient contains the successful Todos query. The server calls:

```ts
dehydrate(queryClient)
```

and emits the result into a JSON bootstrap script:

```html
<script id="rxjs-query-state" type="application/json">...</script>
```

`renderDocument()` now supports generic JSON bootstrap scripts and performs HTML-safe JSON escaping. In particular, `<`, `>`, and `&` are encoded so query data cannot accidentally terminate the script element and become executable HTML.

The bootstrap element is data, not JavaScript code. No query logic is embedded in the document.

### The browser restores Query/Cache before TodoApp subscribes

`src/examples/todos-client.tsx` now performs the bootstrap in this order:

```text
find #app
   ↓
read #rxjs-query-state
   ↓
JSON.parse
   ↓
hydrate(queryClient, state)
   ↓
mount(TodoApp)
   ↓
TodoApp subscribes to queryClient.query$(todosQuery)
```

The ordering is essential.

If `TodoApp` subscribed first, its empty client QueryClient could begin a browser fetch before the server state was restored. Hydrating first means the first browser subscription sees the server-populated cache.

The helper `hydrateQueryClientFromDocument()` performs only this bootstrap boundary. It does not mount UI or choose query behavior.

### Freshness policy prevents the immediate second cold fetch

Hydration alone is not enough.

A query with `staleTime: 0` is stale immediately. The client could correctly restore the server value and then immediately refetch it because the normal query policy says the data is stale.

M08 therefore makes freshness explicit for Todos:

```ts
staleTime: 30_000
```

The temporal behavior is now:

```text
time ─────────────────────────────────────────────►

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

After the freshness window expires, ordinary Query/Cache rules apply again. M08 does not disable refetching; it prevents an unnecessary duplicate read during the initial server-to-browser handoff.

### M08 is data hydration, not DOM hydration

The word "hydrate" here refers specifically to **Query/Cache state**.

The current DOM renderer's `mount()` still owns its container and calls `replaceChildren()`. When the browser client mounts, it may replace the static SSR snapshot with the live RxJS view.

That is deliberately outside the M08 claim.

M08 guarantees:

```text
server query state ──► browser query state
```

It does not yet claim:

```text
server DOM nodes ──► attach bindings in place
```

Keeping those two problems separate makes the architecture easier to reason about. Query-state continuity can be verified independently of a future DOM-hydration strategy.

### M08 source map

```text
src/queries/todos.ts
  createTodosQuery(fetcher)
  shared ['todos'] identity
  explicit staleTime freshness policy

src/server/route-context.ts
  request-scoped QueryClient + in-process fetch contract

src/routes/todos.tsx
  SSR query subscription
  request cancellation with takeUntil
  static TodoSnapshot construction

src/examples/todos.tsx
  shared TodoList
  static TodoSnapshot
  live TodoApp

src/query/ssr.ts
  QUERY_STATE_SCRIPT_ID
  hydrateQueryClientFromDocument()

src/render/html.ts
  generic application/json bootstrap scripts
  HTML-safe JSON serialization

src/server/app.tsx
  request-scoped QueryClient
  router context
  dehydrate() at the HTTP/HTML boundary

src/examples/todos-client.tsx
  restore cache before mount
```

Each file owns one piece of the handoff rather than hiding the complete process behind a new framework lifecycle.

### M08 verification

`scripts/verify.tsx` now checks the continuity contract directly:

- `/todos` SSR contains actual seeded Todo data,
- `/todos` SSR no longer contains the `Loading todos...` placeholder,
- the HTML contains the `rxjs-query-state` bootstrap element,
- a server QueryClient executes a test query exactly once,
- that QueryClient can be dehydrated,
- a fresh browser QueryClient can restore the serialized state,
- the browser query emits the server value after hydration,
- the browser query function is **not executed** while the hydrated data remains fresh,
- TypeScript and both browser bundles still build through the normal `bun run check` pipeline.

The most important executable assertion is:

```text
server query executions   = 1
browser query executions  = 0
browser observed value    = server value
```

That is the concrete M08 definition of client data continuity.

### What M08 establishes

M08 adds a reusable server/browser read path:

```text
route declares query
      ↓
server subscribes
      ↓
request QueryClient remembers result
      ↓
SSR consumes resolved data
      ↓
QueryClient dehydrates into HTML
      ↓
browser QueryClient hydrates before subscription
      ↓
normal RxJS Query/Cache execution continues
```

The server and browser are no longer two unrelated executions that happen to request the same endpoint. They are two phases of one query lifecycle separated by an HTML transport boundary.

The broader principle is: **SSR may resolve the first value, but Query/Cache remains the state machine that owns the read across the boundary.**

## M09 — Static Site Generation

M09 proves that request-time SSR and build-time static generation do not need separate application models.

The framework already had the complete page machine before M09:

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

M09 keeps that machine and changes only **when** it is executed and **what consumes the resulting HTML**.

Request-time SSR:

```text
HTTP request
    ↓
renderRouteDocument()
    ↓
HTML
    ↓
Hono Response
```

Build-time SSG:

```text
build command
    ↓
static route pathname
    ↓
renderRouteDocument()
    ↓
HTML
    ↓
dist/static/.../index.html
```

This is the central M09 rule: **SSG is not a new renderer. It is the existing route-document renderer executed during the build.**

### One route-document renderer now owns page resolution

Before M09, `src/server/app.tsx` contained both HTTP concerns and the reusable page-resolution work: it created the request QueryClient, called `rxjs-router`, rendered the resolved JSX, dehydrated query state, and then returned HTML through Hono.

M09 extracts the reusable part into:

```text
src/render/page.ts
```

Its central operation is:

```ts
renderRouteDocument({
  routes,
  request,
  fetch,
})
```

Conceptually:

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

The result can be a page, redirect, not-found result, or error. The consumer decides what those values mean.

Hono now owns only the HTTP translation:

```text
RouteDocumentResult.page      → context.html(...)
RouteDocumentResult.redirect  → context.redirect(...)
RouteDocumentResult.notFound  → HTTP 404
RouteDocumentResult.error     → HTTP 500
```

The static builder accepts only a successful page result and turns it into a file.

This extraction is important beyond M09: the framework now has an execution boundary that is independent of whether HTML is requested by a live HTTP client or generated ahead of time.

### Static paths come from the generated router tree

M06 already made `src/routes.generated.ts` the generated application route tree. M09 deliberately does **not** add a second `staticRoutes` registry.

Instead, `collectStaticPathnames()` asks `rxjs-router` to normalize that same tree and reads each route node's `fullPath`.

For the current application:

```text
generated route tree
      ↓
normalizeRoutes()
      ↓
/
/about
/counter
/todos
```

The current static set is therefore derived automatically:

```text
/
/about
/counter
/todos
```

Adding another concrete file-discovered route later automatically makes it eligible for the same discovery process.

This preserves the M06 principle: **there is one route tree, not one tree for runtime routing and another manifest for build tooling.**

### Parameterized routes are explicit future build inputs

A concrete route such as:

```text
/about
```

can be generated immediately because its pathname is complete.

A route such as:

```text
/posts/$slug
```

is different. The framework cannot know which `slug` values should exist at build time.

M09 therefore excludes route paths containing build-time parameters rather than guessing values or accidentally writing a literal `$slug` directory.

```text
/posts/$slug
      ↓
requires explicit build-time params
      ↓
not generated by M09 automatic static discovery
```

This is intentional scope, not a limitation hidden by the generator. A later parameterized-SSG feature can supply a list such as:

```text
/posts/rxjs
/posts/functional-programming
/posts/observables
```

and feed those concrete pathnames into the same `renderStaticPage()` operation without changing the renderer.

### Static URL structure maps to directory index files

M09 uses deployment-friendly directory-index output:

```text
/          → dist/static/index.html
/about     → dist/static/about/index.html
/counter   → dist/static/counter/index.html
/todos     → dist/static/todos/index.html
```

That mapping is owned by `staticOutputPath()`.

The output structure means ordinary static hosts can serve clean URLs without requiring framework-specific URL rewriting just to remove `.html` suffixes.

### Build-time pages reuse M08 Query/Cache prefetch

The most important proof route for M09 is `/todos`.

A simplistic SSG implementation could render only routes with synchronous data and leave query-backed pages to the browser. M09 instead reuses the M08 server execution path.

Build-time `/todos` is:

```text
renderStaticPage('/todos')
      ↓
renderRouteDocument()
      ↓
Todos route loader
      ↓
request/build-scoped QueryClient
      ↓
queryClient.query$(createTodosQuery(fetch))
      ↓
GET /api/todos through supplied fetch boundary
      ↓
readonly Todo[]
      ↓
static TodoSnapshot
      ↓
dehydrate(QueryClient)
      ↓
HTML with prefetched Todos + query bootstrap
      ↓
dist/static/todos/index.html
```

The generated page therefore contains the same two outputs as M08 SSR:

```text
visible resolved HTML
+
deferred browser Query/Cache state
```

The build process does not introduce a special Todo reader. `scripts/generate-static.ts` supplies an in-process fetch adapter to the same Hono API contract, so `GET /api/todos` remains the read boundary used by the query.

### Build-time QueryClient state is isolated per generated page

`renderRouteDocument()` creates a fresh QueryClient for every page render.

That gives static generation the same isolation principle M08 established for HTTP requests:

```text
/about build
    ↓
QueryClient A
    ↓
/about HTML

/todos build
    ↓
QueryClient B
    ↓
/todos HTML + dehydrated Todos state
```

Data from one generated page is not implicitly carried into another page's cache.

If the framework later chooses to introduce cross-page build caching, that will be an explicit optimization rather than an accidental consequence of one process-global QueryClient.

### SSG does not weaken the pure HTML renderer

M03 remains unchanged.

`renderToString()` still receives only resolved values and still rejects Observable children.

The timing is:

```text
build-time route/query execution
      ↓
resolved PageData
      ↓
plain/static ViewChild
      ↓
renderToString()
```

M09 therefore adds no subscription logic to the renderer. The static builder coordinates execution before the pure rendering boundary, exactly as SSR does.

### SSG and SSR can be compared directly

Because both modes now call the same `renderRouteDocument()`, deterministic pages can be checked byte-for-byte.

For `/about`:

```text
HTTP /about
    ↓
renderRouteDocument()
    ↓
SSR HTML

build /about
    ↓
renderRouteDocument()
    ↓
static HTML
```

M09 verification asserts that those two HTML strings are identical.

For query-backed pages such as `/todos`, dehydrated query timestamps naturally differ between separate executions, so verification checks the semantic invariants instead:

```text
static page contains resolved Todo data       ✅
static page does not contain Loading todos... ✅
static page contains rxjs-query-state         ✅
bootstrap contains queryKey ['todos']         ✅
```

This distinguishes stable page semantics from incidental execution timestamps.

### The build command is explicit

M09 adds:

```sh
bun run build:static
```

That command:

```text
generate routes
      ↓
discover concrete static pathnames
      ↓
clear dist/static
      ↓
render each pathname
      ↓
create parent directory
      ↓
write index.html
```

The generator logs each mapping, for example:

```text
/ -> dist/static/index.html
/about -> dist/static/about/index.html
/counter -> dist/static/counter/index.html
/todos -> dist/static/todos/index.html
```

`dist/` remains build output and is therefore still excluded from Git.

### M09 source map

```text
src/render/page.ts
  renderRouteDocument()
  shared route/data/query/HTML execution
  page / redirect / notFound / error result

src/server/app.tsx
  Hono HTTP adapter around renderRouteDocument()

src/ssg/static.ts
  collectStaticPathnames()
  staticOutputPath()
  renderStaticPage()

scripts/generate-static.ts
  build entry point
  static path iteration
  output-directory creation
  HTML file writes

scripts/verify-static.ts
  physical artifact verification
  SSR/SSG /about equivalence
  static /todos Query/Cache assertions

scripts/verify.tsx
  static route discovery semantics
  parameterized-route exclusion
  in-memory build-time rendering assertions

package.json
  build:static
  verify:static
  M09 steps in the complete check pipeline
```

### M09 verification

M09 is protected at two levels.

The normal executable verifier checks the framework behavior before files are written:

- static pathnames are derived from the generated route tree,
- the current set is exactly `/`, `/about`, `/counter`, and `/todos`,
- root output maps to `dist/static/index.html`,
- nested output maps to directory-index files,
- parameterized `$...` routes are excluded without supplied build-time params,
- build-time `/about` rendering equals request-time SSR byte-for-byte,
- build-time `/todos` contains prefetched query data,
- build-time `/todos` retains the M08 dehydrated Query/Cache bootstrap.

The static artifact verifier then runs after `scripts/generate-static.ts` and checks the actual files:

- every discovered concrete route produced an HTML file,
- `dist/static/about/index.html` equals live SSR output for `/about`,
- `dist/static/todos/index.html` contains the seeded Todo data,
- the static Todos page has no loading placeholder,
- the static Todos page contains the `rxjs-query-state` element,
- its dehydrated state contains the `['todos']` query identity.

The complete acceptance pipeline is now conceptually:

```text
route generation
      ↓
strict TypeScript
      ↓
M01-M09 executable verification
      ↓
static site generation
      ↓
static artifact verification
      ↓
browser client bundles
```

### What M09 establishes

M09 turns the page pipeline into a reusable execution engine rather than an HTTP-only feature.

```text
                     ┌── request time ──► Hono Response
route/data/JSX/HTML ─┤
                     └── build time ────► static index.html
```

Everything above that final consumer remains the same:

```text
routes
  ↓
loaders
  ↓
RxJS / Query/Cache execution
  ↓
resolved model
  ↓
JSX
  ↓
pure HTML rendering
```

That is the larger M09 result: **SSR and SSG are execution-time policies around the same RxJS Fullstack page machine.**

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
