<p align="center">
  <img src="./assets/rxjs-fullstack-logo.webp" alt="RxJS Fullstack logo" width="360" />
</p>

# RxJS Fullstack

`rxjs-fullstack` is an experiment in a minimal fullstack web framework whose application execution model is RxJS.

The framework deliberately leaves existing technologies in charge of the jobs they already solve:

- **TypeScript** — language, strong typing, and JSX compilation.
- **RxJS 7** — lazy dataflows, state, effects, cancellation, sharing, and Query/Cache.
- **TypeScript JSX** — view syntax without React.
- **Functional Component Algebra** — typed composition of `Component<Model, Message>` application views.
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
M11  Database Integration                         ✅
M12  Authentication                               ✅
M13  Streaming / Advanced SSR                     ✅
M14  Functional Component Algebra                 ✅
```

## M01 — TypeScript JSX runtime

M01 establishes a framework-owned view representation without React.

TypeScript compiles TSX through the automatic JSX runtime (`jsx: "react-jsx"` with `jsxImportSource` pointing at the framework's own `src/jsx/jsx-runtime.ts` — the setting's name is historical; React is not involved). The compiler injects the runtime import itself, so view modules never import a JSX factory manually, and fragments (`<>...</>`) type-check. JSX therefore produces `ViewChild` values rather than DOM nodes or React elements.

The intrinsic JSX surface is deliberately typed: standard HTML tag names are accepted, common attributes are explicit, and `data-*` / `aria-*` remain extensibility points, so misspelled tags or unsupported attributes fail typechecking. The runtime supports primitives, intrinsic elements, fragments, function components, nested children, and RxJS Observables as live view values. It does not render, subscribe, create DOM, or own lifecycle.

The implementation lives in `src/jsx/runtime.ts`.

## M02 — RxJS DOM bindings

M02 interprets the same `ViewChild` representation in the browser.

`mount(view, container)` returns the RxJS `Subscription` that owns the mounted view's lifetime. Observable children and attributes are subscribed only when the view is mounted. Unsubscribing tears down event listeners, child subscriptions, live regions, and the mounted DOM.

DOM events flow into RxJS through `Observer`s:

```tsx
<button on={{ click: click$ }}>...</button>
```

The renderer only forwards event packages. Application meaning remains in the RxJS pipeline.

Live form state is the one exception to attribute binding: `value`, `checked`, and `selected` are assigned through the DOM property, because their attributes only set a control's default state and stop reflecting once the user has interacted with it. Everything else binds as an attribute.

Errors follow the same ownership rule: recovery belongs in the application dataflow (`catchError`), not in the renderer. If an Observable child or attribute binding errors anyway, the renderer tears the binding down — the live region is cleared, a failed attribute is removed — and reports the error through `mount()`'s optional `onError` hook. By default the error is rethrown as an unhandled error, so failures stay loud instead of freezing stale DOM.

The implementation lives in `src/render/dom.ts`. Its invariants have their own executable verification (`scripts/verify-dom.tsx`), which runs the renderer against a real DOM implementation: events dispatched on rendered elements reach their `Observer`s and drive the counter state machine, every live-region emission tears down the previous child's subscription **before** the replacement renders, replaced children lose their event listeners, unsubscribing the `mount()` Subscription removes the DOM and closes every Observable binding, and erroring bindings clear their region or attribute and reach the `onError` hook.

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

An earlier standalone typed-route experiment in `src/router/` proved the routing type model with path-literal-derived params and typed `href(...)` generation. It has since been removed: `rxjs-router` itself provides the same guarantees through `PathParams` inference and typed `buildPath(...)` URL construction, and the dynamic `/hello/$name` page now lives in the application route tree as an ordinary discovered route module.

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

## M11 — Database Integration

M11 replaces the process-local Todo array with an explicit persistence boundary while preserving the RxJS Fullstack machine built in M01–M10.

The database is deliberately treated as another effect dependency. It does not become a new state-management system, router, action mechanism, or rendering lifecycle.

Before M11, the server-side Todo source of truth was a module-local array:

```text
GET /api/todos ─────────────► in-process Todo[]

server action ──────────────► addTodo()
                                  ↓
                            in-process Todo[]
```

M11 changes the persistence boundary to:

```text
                           TodoRepository
                          /              \
                         /                \
                        ▼                  ▼
              memory repository       PGlite/Postgres
              tests / portable        Bun / Node
              compositions            persistent host
```

The application sees only the repository contract. The composition root decides which implementation supplies the effect.

The central M11 rule is: **persistence changes where Todo data is stored; it does not change how values move through RxJS Fullstack.**

### The repository is a typed effect port

The application-facing database contract lives in:

```text
src/database/todos-repository.ts
```

Its essential shape is:

```ts
interface TodoRepository {
  list$(options?): Observable<readonly Todo[]>;
  create$(input, options?): Observable<Todo>;
  close(): Promise<void>;
}
```

This contract says what packages move through the persistence boundary:

```text
list$    : ()              → Observable<readonly Todo[]>
create$  : CreateTodoInput → Observable<Todo>
```

It deliberately does not expose:

- PGlite objects,
- SQL result objects,
- Hono contexts,
- QueryClient,
- browser state,
- server-action references,
- runtime-specific APIs.

The database adapter knows persistence. The rest of the framework continues to know only domain values and Observables.

### Database reads and writes remain cold

Repository operations are descriptions until subscribed.

For a write:

```text
const save$ = repository.create$(input)
        │
        │ no subscription
        ▼
      no SQL

subscribe
   ↓
INSERT starts
   ↓
Todo emitted
   ↓
complete
```

Both the memory repository and the PGlite repository implement read/write operations with `defer(...)`.

This means constructing a database Observable does not eagerly perform the database effect. The same RxJS execution rule that applies to HTTP actions and other effects now applies to persistence.

### Repository initialization is intentionally different from repository operations

M11 separates two lifetimes that should not be confused.

Repository initialization belongs to the composition root:

```text
process starts
    ↓
open database
    ↓
apply migrations
    ↓
seed if empty
    ↓
construct application
    ↓
start accepting requests
```

Individual reads and writes remain cold:

```text
request arrives
    ↓
repository.list$() or repository.create$()
    ↓
Observable description
    ↓
subscription at the HTTP/action boundary
    ↓
SQL executes
```

Opening the database and making the schema ready before the server accepts traffic is intentional. Laziness applies to application database effects, not to pretending that a server can use an unopened database.

### PGlite is the reference Postgres adapter

M11 uses PGlite as the reference embedded Postgres implementation for Bun and Node.js.

The adapter lives in:

```text
src/database/pglite-todos-repository.ts
```

The important architectural choice is not that every `rxjs-fullstack` application must use PGlite. It is that a concrete Postgres-compatible database can satisfy the same `TodoRepository` port without leaking database-specific APIs upward.

The current persistent composition is:

```text
Bun / Node process
      ↓
createPgliteTodoRepository()
      ↓
TodoRepository
      ↓
createApp({ todosRepository })
      ↓
Hono / RxJS Fullstack
```

A later PostgreSQL server, SQLite adapter, remote database service, or application-specific persistence layer can implement the same role without changing the browser query/action machine.

### SQL stays visible

M11 deliberately does not add an ORM.

The Todo read is conceptually:

```sql
SELECT id, title, done
FROM todos
ORDER BY id
```

The write is a parameterized statement:

```sql
INSERT INTO todos (title, done)
VALUES ($1, FALSE)
RETURNING id, title, done
```

The domain value is passed separately from the SQL text:

```text
CreateTodoInput.title
       ↓
parameter $1
       ↓
Postgres insert
       ↓
Todo row
       ↓
Todo
```

Keeping SQL explicit matches the rest of the project: mechanisms remain visible rather than being renamed or hidden behind domain-sounding wrappers.

### Schema changes are versioned migrations

The database adapter does not assume that the schema already exists.

M11 adds a migration ledger:

```text
rxjs_fullstack_migrations
```

The first application migration is:

```text
version 1 — create_todos
```

which creates:

```text
todos
├── id    SERIAL PRIMARY KEY
├── title TEXT NOT NULL
└── done  BOOLEAN NOT NULL DEFAULT FALSE
```

Initialization proceeds as:

```text
open PGlite
    ↓
ensure migration ledger exists
    ↓
read applied versions
    ↓
for each unapplied migration
    ↓
transaction
   ├── apply SQL
   └── record version/name
```

The schema history is therefore explicit and repeatable instead of being inferred from application objects at runtime.

### Seed data is idempotent

The two canonical Todo examples remain useful as the initial project dataset.

M11 moves them into a shared seed definition and inserts them only when the Todo table is empty.

```text
fresh database
    ↓
COUNT(*) = 0
    ↓
insert canonical seed rows

reopened database
    ↓
COUNT(*) > 0
    ↓
do not seed again
```

This matters because persistence must survive restart without duplicating the example data every time the application boots.

### The old array store disappears from the active architecture

M07's historical chapter documents the original `src/server/todos-store.ts` because that was the implementation at that milestone.

M11 removes that file from the current source tree.

The transition is:

```text
M07–M10
server/api.ts
    ↓
todos-store.ts
    ↓
module-local array

M11
server/api.ts
    ↓
TodoRepository
    ↓
selected repository adapter
```

The historical README remains intact, but the current application no longer imports a persistence implementation directly from the server API.

### `createApi()` receives persistence instead of importing it

The API boundary is now constructed with:

```ts
createApi({ todosRepository })
```

The read path becomes:

```text
GET /api/todos
      ↓
todosRepository.list$({ signal })
      ↓
firstValueFrom(...)
      ↓
readonly Todo[]
      ↓
JSON Response
```

The write path becomes:

```text
POST /api/actions/todos.create
      ↓
server-action validation
      ↓
todosRepository.create$(input, { signal })
      ↓
Todo
      ↓
HTTP 201
```

Hono still owns HTTP. The repository owns persistence. RxJS still describes the effect.

### `createApp()` becomes the application composition boundary

M11 adds dependency injection at the application root:

```ts
createApp({ todosRepository })
```

This prevents the Hono application from choosing a database internally.

The composition options are now explicit:

```text
createApp(memoryRepository)
        │
        ├── deterministic verifier
        ├── SSG process
        └── fetch-native portable composition

createApp(pgliteRepository)
        │
        ├── Bun server
        └── Node.js server
```

The default exported `app` remains backed by the deterministic memory repository. That keeps framework verification, static generation, and the fetch-native M10 proof independent of filesystem/database-runtime requirements.

Persistent runtime entry points deliberately inject PGlite themselves.

### Bun and Node are database composition roots

M10 established that runtime adapters should only host an application. M11 preserves that principle by separating the generic host adapter from the database-aware process entry.

For Bun:

```text
src/runtime/bun-server.ts
      ↓
open PGlite
      ↓
createApp({ todosRepository })
      ↓
createBunServerOptions(..., app.fetch)
      ↓
Bun hosts fetch
```

For Node:

```text
src/runtime/node.ts
      ↓
open PGlite
      ↓
createApp({ todosRepository })
      ↓
createNodeServer({ fetch: app.fetch })
      ↓
@hono/node-server
      ↓
Node HTTP server
```

The generic `src/runtime/bun.ts` and `src/runtime/node-adapter.ts` remain host adapters. They now accept an injected fetch handler instead of selecting persistence themselves.

This keeps the dependency direction correct:

```text
runtime composition root
    ↓ chooses
repository implementation
    ↓ injected into
application
    ↓ hosted by
runtime adapter
```

### Persistent data has an explicit location

The reference Bun/Node database defaults to:

```text
./.rxjs-fullstack-db
```

That path is excluded from Git.

Deployments and local development can choose another location with:

```text
DATABASE_PATH=/path/to/database
```

For example:

```sh
DATABASE_PATH=./data/dev-postgres bun run dev:bun
```

The database path is process/deployment configuration, not a route or domain concern.

### M11 preserves M08 Query/Cache semantics

The browser query has not been rewritten to know about SQL.

The read dataflow remains:

```text
TodoApp subscription
      ↓
queryClient.query$(todosQuery)
      ↓
GET /api/todos
      ↓
TodoRepository.list$()
      ↓
PGlite SELECT
      ↓
readonly Todo[]
      ↓
HTTP JSON
      ↓
Query/Cache
      ↓
view
```

The browser still sees the same query key and the same `readonly Todo[]` package.

M11 changes the server source of truth behind the existing HTTP/query contract; it does not make Query/Cache a database abstraction.

### M11 preserves M07 server-action semantics

The create path also keeps its existing temporal policy:

```text
form submit
    ↓
exhaustMap
    ↓
createTodo$()
    ↓
server action
    ↓
TodoRepository.create$()
    ↓
PGlite INSERT
    ↓
Todo
    ↓
invalidate ['todos']
    ↓
GET /api/todos
    ↓
PGlite SELECT
```

`exhaustMap` still means **ignore while busy**. `concatMap` still sequences post-write query invalidation. The database adapter does not choose either policy.

The important transition is only:

```text
old write target   module-local array
new write target   persistent repository
```

### Cancellation is explicit, with a precise boundary

Database repository methods accept the request `AbortSignal`.

Before starting each SQL operation, the adapter checks:

```text
signal.aborted?
    ├── yes → error before SQL starts
    └── no  → execute SQL
```

This means a request cancelled before the database effect begins does not start that effect.

The current PGlite repository does **not** claim that unsubscribing can forcibly cancel a SQL statement that has already entered PGlite. Once the Promise-backed query has started, RxJS can stop downstream ownership, but this adapter has no mid-query database cancellation primitive to invoke.

That distinction is intentional and documented:

```text
before SQL begins       AbortSignal can prevent start
already-running SQL     no forced PGlite cancellation claimed
```

M11 therefore keeps cancellation explicit without promising a capability the database adapter does not provide.

### PGlite process behavior is contained at the adapter boundary

During verification, PGlite's Emscripten runtime exposed an integration detail: database initialization/close could leave the host process `exitCode` changed even though all application assertions had succeeded.

M11 contains that behavior inside the PGlite adapter by preserving the surrounding process exit verdict around create/close.

The rule is the same architectural rule used elsewhere:

```text
library/runtime implementation detail
          ↓
contained by adapter
          ↓
application process semantics remain stable
```

The verifier includes an assertion protecting this boundary so a successful database run cannot silently turn into a failing host process.

### Node bundling keeps PGlite's runtime assets external

The Node application bundle is built with PGlite externalized:

```text
bun build src/runtime/node.ts
  --target node
  --external @electric-sql/pglite
```

This keeps PGlite's package/runtime assets available from the installed dependency rather than trying to collapse the database runtime into the single application bundle.

At the same time, the fetch-native edge build still targets the browser/edge graph and does not import the filesystem-backed PGlite composition root.

This preserves M10's dependency-boundary test:

```text
filesystem database adapter
        │
        ├── Bun / Node composition roots
        │
        └── not required by portable worker app.fetch graph
```

### Persistence survives process-style reopen

M11 verifies actual filesystem persistence, not just a database call that succeeds once.

The proof is:

```text
create filesystem PGlite repository
      ↓
insert Todo
      ↓
close repository
      ↓
open a new repository at same path
      ↓
SELECT todos
      ↓
created Todo is still present
```

It also verifies that reopening does not duplicate seed data.

This is the point where the Todos vertical slice gains a persistent source of truth rather than process lifetime state.

### M11 source map

```text
src/database/todos-repository.ts
  TodoRepository port
  RepositoryOperationOptions
  abort-before-start guard

src/database/todos-seed.ts
  canonical seed data

src/database/memory-todos-repository.ts
  deterministic cold repository
  tests / SSG / portable composition

src/database/migrations.ts
  versioned database migration definitions

src/database/pglite-todos-repository.ts
  embedded Postgres adapter
  migration runner
  seed runner
  parameterized SQL
  process-exit-state containment

src/server/api.ts
  repository-injected GET /todos
  repository-injected create server action

src/server/app.tsx
  createApp({ todosRepository })
  default deterministic memory composition

src/runtime/bun.ts
  generic Bun host accepting fetch injection

src/runtime/bun-server.ts
  persistent Bun composition root
  PGlite + createApp + Bun host

src/runtime/node-adapter.ts
  generic Node host accepting fetch injection

src/runtime/node.ts
  persistent Node composition root
  PGlite + createApp + Node host

scripts/verify-database.ts
  coldness
  migration/seed
  filesystem persistence
  API/action database integration
  process-exit isolation

scripts/verify-runtimes.ts
  real Node process with temporary DATABASE_PATH
  database-backed runtime assertion
```

### M11 verification

M11 adds a dedicated database verifier and extends the runtime verifier.

The database verification proves that:

- constructing a repository write Observable does not perform the write,
- subscribing executes exactly the described repository effect,
- a fresh PGlite database receives the expected schema and two seed Todos,
- a PGlite insert is also cold before subscription,
- the insert returns the generated Todo id,
- closing and reopening the filesystem-backed database preserves that Todo,
- migrations and seed initialization are idempotent across reopen,
- a Hono application injected with the PGlite repository reads through the database,
- the existing `todos.create` server action writes through the database,
- the existing GET/query path sees the committed server-action write,
- PGlite does not leak its internal process exit state into the successful host process.

The real runtime verification additionally proves that:

- the Node bundle starts under the actual `node` executable,
- Node initializes a PGlite repository at a temporary filesystem path,
- `/health` and SSR behavior remain intact,
- `/api/todos` returns the seeded database data from that live Node process,
- temporary database state is cleaned up after the process is terminated.

The final CI acceptance path is:

```text
route generation
      ↓
strict TypeScript
      ↓
M01-M11 executable verification
      ↓
M11 database integration verification
      ↓
static generation + verification
      ↓
Node runtime build
      ↓
edge/Worker build
      ↓
real Node + database runtime verification
      ↓
browser client bundles
```

### What M11 establishes

M11 gives `rxjs-fullstack` a persistent server-side source of truth without changing the application execution model.

```text
browser / SSR / SSG
       ↓
Query/Cache + server actions
       ↓
Hono API
       ↓
TodoRepository Observable effects
       ↓
selected persistence adapter
       ├── memory
       └── PGlite/Postgres
```

The layers remain independently understandable:

```text
RxJS chooses execution and temporal policy.
Query/Cache owns cached server reads.
Server actions own typed write effects.
Hono owns HTTP.
TodoRepository owns the persistence contract.
PGlite owns the reference Postgres implementation.
Runtime composition roots choose concrete dependencies.
```

That is the larger M11 result: **the source of truth can move from memory to a real persistent database while the RxJS machine stays the same.**

## M12 — Authentication

M12 adds identity, server-side sessions, and protected routing without turning authentication into a second application framework.

The application now has two categories of server state:

```text
business state                    security state
TodoRepository                    AuthRepository
      │                                 │
      ▼                                 ▼
Todos / mutations                users / sessions
      │                                 │
      └──────────────┬──────────────────┘
                     ▼
                 PGlite/Postgres
```

The important design rule is: **the server remains authoritative for identity; the browser carries credentials and opaque cookies, not an authentication state machine.**

M12 deliberately does not introduce JWTs, browser `localStorage`, or a framework-owned client auth store.

### Authentication operations are cold RxJS effects

The domain-facing authentication service is:

```text
AuthService
├── register$(credentials)
├── login$(credentials)
├── resolveSession$(sessionToken, csrfToken)
└── logout$(sessionToken, csrfToken)
```

Each operation returns an Observable and is implemented with `defer(...)`.

For registration:

```text
const register$ = authService.register$(credentials)
       │
       │ no subscription
       ▼
no user is created

subscribe
   ↓
lookup email
   ↓
derive password hash
   ↓
persist user
   ↓
AuthUser emitted
```

The same rule applies to login, session resolution, and logout: constructing the Observable describes the effect; subscription starts the effect.

This keeps authentication inside the same RxJS execution model used by queries, server actions, and database effects.

### Credential parsing is an explicit trust boundary

Authentication form data reaches the server as untrusted values.

`src/auth/credentials.ts` normalizes and validates the credential package before the authentication service receives it:

```text
FormData
  ↓
unknown email/password values
  ↓
parseAuthCredentials()
  ↓
normalized email
  +
password length policy
  ↓
AuthCredentials
```

The current input policy is:

```text
email       trimmed + lowercased, max 254 characters
password    12–128 characters
```

The parser is not a substitute for authentication. It only determines whether the incoming package has the shape the authentication machine is willing to process.

### Passwords become slow salted derivations before persistence

M12 never stores a plaintext password.

The reference password hasher uses Web Crypto PBKDF2 with HMAC-SHA-256:

```text
password
   +
random 16-byte salt
   ↓
PBKDF2-HMAC-SHA256
600,000 iterations
   ↓
32-byte derived key
   ↓
encoded password record
```

The stored format is explicit:

```text
pbkdf2-sha256$iterations$salt$derived-key
```

The production policy is:

```ts
PBKDF2_ITERATIONS = 600_000
```

The use of Web Crypto is deliberate: the same cryptographic boundary is available in the supported modern JavaScript runtimes, while the actual password policy remains behind the `PasswordHasher` interface and can later be replaced without changing the route, repository, or session model.

Verification uses a deliberately smaller iteration count for speed, while separately asserting that the production constant remains `600_000`.

### Password comparison does not compare plaintext records

Login resolves the stored user by normalized email, derives the candidate password with the stored salt and iteration count, and compares derived bytes using a timing-stable accumulator.

Conceptually:

```text
submitted password
       ↓
derive with stored salt/policy
       ↓
candidate bytes
       │
       ├──── constant-time byte comparison ──── stored bytes
       │
       ▼
match / reject
```

A failed password never creates a session.

### Sessions are opaque server-side records

M12 does not encode user identity or authorization claims into a browser-readable bearer object.

Successful login generates two independent 32-byte random values:

```text
session token      256 random bits
CSRF token         256 random bits
```

The raw session token is returned only to the browser cookie boundary. Before persistence it is hashed with SHA-256:

```text
random session token
        ↓
SHA-256
        ↓
token_hash stored in auth_sessions
```

The database never needs the bearer token itself.

The server-side session record contains:

```text
token_hash
user_id
csrf_hash
expires_at
created_at
```

The raw token therefore has one purpose: prove possession when the browser makes a later request.

### Session lifetime is explicit

The current session TTL is seven days:

```text
login
  ●──────────────────────────────●
  now                       expiresAt
            7 days
```

When a session is resolved, M12 checks the stored expiry. An expired session is deleted and treated as unauthenticated.

Session expiry remains server-authoritative even though the browser cookie receives a corresponding `Max-Age`.

### The session cookie is intentionally boring

The browser receives the opaque session token in cookie `id`.

Its important attributes are:

```text
Path=/
HttpOnly
SameSite=Strict
Max-Age=<session TTL>
Secure on HTTPS
```

The cookie contains no user profile, role list, route state, Query/Cache state, or serialized Observable.

Because it is `HttpOnly`, normal browser JavaScript does not need access to the session bearer token.

On HTTPS requests the cookie is also emitted with `Secure`; the verifier checks this behavior explicitly.

### CSRF uses a session-bound companion token

M12 also issues cookie `csrf`.

Unlike the session cookie, the CSRF companion is not `HttpOnly`, because the current logout form must be able to carry the token as form data. It still uses:

```text
Path=/
SameSite=Strict
Max-Age=<session TTL>
Secure on HTTPS
```

The server stores only `SHA-256(csrfToken)` in the session row.

For logout, three values must agree:

```text
hidden form csrf token
       │
       │ constant-time equality
       ▼
csrf cookie token
       │
       │ SHA-256
       ▼
stored session csrf_hash
```

If any relationship fails, logout returns HTTP `403` and the session remains active.

### Authentication mutations also enforce same-origin intent

Registration, login, and logout reject explicit cross-site mutation requests.

The HTTP boundary compares the request `Origin` with the request URL origin and rejects `Sec-Fetch-Site: cross-site`.

Conceptually:

```text
POST /auth/*
     ↓
explicit cross-site request?
   ├── yes → 403
   └── no  → continue authentication flow
```

This is additive defense alongside `SameSite=Strict` cookies and the logout CSRF token.

### Cookie issuance stays at the HTTP boundary

M07 established generic RxJS server actions for application effects. M12 deliberately does not force login into that abstraction.

Authentication has HTTP-specific response semantics:

```text
successful login
     ↓
Set-Cookie: id=...
Set-Cookie: csrf=...
     ↓
303 redirect
     ↓
/account/profile
```

Those are transport concerns owned by Hono.

The separation is:

```text
AuthService.login$()
   owns authentication execution

AuthRepository
   owns persistence

Hono /auth/login
   owns FormData, cookies, status code, redirect
```

The HTTP adapter subscribes to the cold authentication Observable and translates the resolved result into cookies and a redirect. M12 therefore reuses RxJS without hiding HTTP protocol behavior behind a generic action name.

### Registration uses POST/redirect/GET

The public registration page renders an ordinary HTML form:

```text
GET /register
      ↓
HTML form
      ↓
POST /auth/register
      ↓
register$()
      ↓
user persisted
      ↓
303 /login?registered=1
```

A successful registration does not automatically create a logged-in session. The user explicitly crosses the login boundary afterward.

This keeps account creation and session creation as two separate effects.

### Login creates the session and redirects to protected content

Login is:

```text
GET /login
   ↓
HTML form
   ↓
POST /auth/login
   ↓
parse credentials
   ↓
AuthService.login$()
   ↓
password verification
   ↓
persist hashed session identity
   ↓
Set-Cookie id + csrf
   ↓
303 /account/profile
```

Invalid credentials do not reveal whether the email or password was the failing component; the login page receives one generic invalid-credentials state.

### Authentication is resolved before route rendering

For page requests, `src/server/app.tsx` resolves the current session before it invokes the route-document renderer:

```text
HTTP request
    ↓
read id + csrf cookies
    ↓
AuthService.resolveSession$()
    ↓
ResolvedAuthSession | null
    ↓
renderRouteDocument({ auth })
    ↓
ServerRouteContext.auth
    ↓
rxjs-router loader
```

The route therefore receives already-resolved identity state rather than parsing cookies or querying the session table itself.

This extends the same boundary pattern used for M08 query prefetch: asynchronous work resolves before pure view rendering.

### Protected routing is server-authoritative

M12 adds:

```text
/account/$section
```

The account loader inspects `ServerRouteContext.auth`.

Anonymous request:

```text
GET /account/profile
      ↓
auth = null
      ↓
rxjs-router redirect()
      ↓
302 /login
```

Authenticated request:

```text
GET /account/profile
      ↓
valid server session
      ↓
auth.user
      ↓
AccountPage
      ↓
200 protected SSR
```

This is authorization at the server route boundary. The browser does not decide that it is logged in merely because it has rendered some client state.

### The authenticated user is a small package

The route context carries:

```text
ResolvedAuthSession
├── user
│   ├── id
│   └── email
├── sessionTokenHash
├── csrfValid
└── csrfToken?  only when the cookie matches the stored session hash
```

The password hash and raw session token never enter route JSX.

The protected page receives only the values it needs to render authenticated identity and a safe logout form.

### Authentication pages are not cached as personalized runtime responses

Runtime responses for:

```text
/login
/register
/account/*
```

receive:

```text
Cache-Control: no-store
```

This avoids treating auth-related runtime pages as reusable personalized cache entries.

The static forms `/login` and `/register` contain no user-specific server state, so they can still be generated as public static HTML; the runtime response policy remains `no-store` when those routes are served dynamically.

### M12 composes with M09 SSG instead of disabling it

Route discovery now finds seven page modules, but automatic static generation produces six concrete public paths:

```text
/
/about
/counter
/login
/register
/todos
```

The protected account route is intentionally:

```text
/account/$section
```

and M09's existing rule excludes parameterized routes from automatic generation.

That gives M12 a useful boundary:

```text
public auth entry pages       static-capable
protected user route          request-time only
```

No special `if (route === account)` branch was added to the SSG engine.

### M12 extends the M11 migration history

Authentication persistence is migration version 2:

```text
version 1  create_todos
version 2  create_authentication
```

The new schema is:

```text
auth_users
├── id
├── email UNIQUE
├── password_hash
└── created_at

auth_sessions
├── token_hash PRIMARY KEY
├── user_id → auth_users(id)
├── csrf_hash
├── expires_at
└── created_at
```

Deleting an auth user cascades to that user's sessions.

An index on `auth_sessions.expires_at` establishes the obvious future cleanup path without introducing a cleanup scheduler into M12.

### Todos and authentication share one persistent database process

M11 originally opened PGlite for the Todo repository. M12 refactors that composition so Bun and Node open one database and derive both repositories from it:

```text
openPgliteDatabase()
        ↓
        ├── TodoRepository
        │
        └── AuthRepository
        ↓
createApp({
  todosRepository,
  authRepository
})
```

The process owns one database lifetime and closes it once.

The repository interfaces remain independent even though the reference implementation shares one Postgres engine.

### Portable composition remains possible

The default exported application uses:

```text
memory TodoRepository
+
memory AuthRepository
```

That keeps framework verification, SSG, and the fetch-native runtime graph independent of filesystem persistence.

Bun and Node composition roots instead inject the PGlite-backed repositories.

This preserves the M10/M11 dependency direction:

```text
runtime composition root
      ↓ chooses
persistence implementations
      ↓ injected into
application
      ↓ hosted by
runtime adapter
```

Authentication therefore does not make `app.fetch` intrinsically filesystem-bound.

### Auth persistence also remains observable and cancellable-before-start

The generic `RepositoryOperationOptions` introduced for M11 is now shared by Todo and Auth repositories.

Before starting a repository effect, the implementation checks the request `AbortSignal`.

```text
request aborted before repository effect?
   ├── yes → do not start persistence operation
   └── no  → run operation
```

As with M11, M12 does not claim that a Promise-based Web Crypto operation or an already-entered PGlite query can be forcibly interrupted mid-operation when the underlying API provides no such primitive.

The cancellation claim remains precise rather than aspirational.

### No browser auth store is required

M12 does not add:

```text
BehaviorSubject<CurrentUser>
localStorage session token
JWT decoder
client auth singleton
```

The browser has ordinary web state:

```text
HttpOnly session cookie
CSRF companion cookie
current rendered page
```

When the application needs authoritative identity, it asks the server either by navigating to a protected route or by calling:

```text
GET /auth/session
```

That endpoint returns only the current user or `null`; the session itself remains server-side.

### M12 source map

```text
src/auth/types.ts
  AuthUser / credentials / created and resolved session packages

src/auth/credentials.ts
  email normalization
  credential parsing and length policy

src/auth/password.ts
  PBKDF2 PasswordHasher
  random opaque token creation
  SHA-256 token hashing
  timing-stable equality

src/auth/service.ts
  cold register$ / login$ / resolveSession$ / logout$
  session TTL
  auth-specific errors

src/database/repository.ts
  shared repository AbortSignal options

src/database/auth-repository.ts
  typed AuthRepository persistence port

src/database/memory-auth-repository.ts
  deterministic portable auth persistence

src/database/pglite-database.ts
  shared PGlite open/migrate/seed/close lifetime

src/database/pglite-auth-repository.ts
  explicit SQL auth persistence

src/database/pglite-application-repositories.ts
  one PGlite instance
  TodoRepository + AuthRepository composition

src/database/migrations.ts
  migration 2: auth_users + auth_sessions

src/server/auth.ts
  Hono form/cookie/redirect boundary
  same-origin mutation checks
  CSRF verification
  request session resolution

src/server/app.tsx
  AuthService composition
  /auth registration
  session resolution before page rendering
  no-store auth page policy

src/server/route-context.ts
  resolved auth package available to route loaders

src/render/page.ts
  inject auth into rxjs-router context

src/routes/login.tsx
  public login page

src/routes/register.tsx
  public registration page

src/routes/account.tsx
  protected /account/$section route
  anonymous redirect

src/examples/auth.tsx
  pure SSR login/register/account views

scripts/verify-auth.ts
  authentication semantic and persistence verification

scripts/verify-runtimes.ts
  actual Node registration/login/cookie/protected-SSR proof
```

### M12 verification

The dedicated authentication verifier treats the security and execution model as executable requirements.

It proves that authentication operations are cold, passwords are stored only as salted PBKDF2 derivations, opaque server-side sessions are hashed before persistence, cookies carry the expected security attributes, cross-site mutations and bad CSRF logout attempts are rejected, protected routes require a valid server-resolved session, logout revokes that session, and PGlite users/sessions survive database reopen.

The actual runtime verifier additionally starts the real Node bundle with a temporary PGlite database and proves registration, login, cookie handling, and authenticated `/account/profile` SSR end to end.

### What M12 establishes

M12 adds a reusable identity boundary while preserving the framework's existing responsibilities:

```text
browser request
      ↓
Hono HTTP boundary
      ↓
opaque session cookie
      ↓
AuthService.resolveSession$()
      ↓
AuthRepository
      ↓
ResolvedAuthSession | null
      ↓
ServerRouteContext.auth
      ↓
rxjs-router authorization decision
      ↓
resolved ViewChild
      ↓
pure SSR
```

The broader M12 principle is: **authentication changes who may execute a route; it does not change the RxJS machine that executes the application.**

## M13 — Streaming / Advanced SSR

M13 completes the original roadmap by adding progressive HTML delivery without adding a second rendering or execution model.

Before M13, request-time SSR always waited until a complete page could be serialized into one HTML string. M13 adds a second delivery policy for pages whose server work can be usefully revealed in phases while preserving buffered SSR and SSG.

The page contract gains an optional `stream$: Observable<ViewChild>`. The existing `view` remains the immediately available server representation; `stream$` describes later complete ViewChild chunks. The route declares progressive values but does not write bytes or own `ReadableStream`.

M03's renderer rule remains unchanged: `renderToString()` still never subscribes. Each stream emission is first resolved by RxJS, then passed as a plain `ViewChild` to the pure renderer.

`renderDocumentStream()` translates rendered strings to a Web `ReadableStream<Uint8Array>`, and `renderRouteResponse()` chooses buffered or progressive response delivery after the route has been resolved. The same route tree, loaders, QueryClient, JSX representation, and renderer are reused.

The `/streaming` proof route emits an immediate shell, an intermediate timed chunk, and a final Query/Cache-backed Todo chunk. Query state is dehydrated only after the stream completes so the final HTML contains cache state produced by the entire streamed server execution.

Cancellation preserves RxJS ownership: cancelling the Web response body unsubscribes the body Observable. Post-start errors cannot change the already-committed HTTP status, so they are rendered as a generic in-band failure fragment without leaking internal exception details.

The same route is progressive at request time and buffered during SSG. M13 therefore changes delivery timing rather than creating a second page implementation.

### M13 source map

```text
src/routes/types.ts
  optional stream$: Observable<ViewChild>

src/render/html.ts
  document prefix/suffix
  renderDocumentStream()
  Web stream cancellation → RxJS unsubscribe
  generic in-band stream error fallback

src/render/page.ts
  shared route-resolution plan
  buffered and request-time consumers
  final Query/Cache dehydration

src/server/app.tsx
  HTTP translation for streaming responses
  streaming response headers

src/routes/streaming.tsx
  shell
  timed RxJS chunk
  Query/Cache-backed Todo chunk
  request AbortSignal integration

scripts/verify-streaming.ts
  early-shell, completion, query-state, cancellation, and error proofs

scripts/verify-static.ts
  complete generated /streaming artifact proof

scripts/verify-runtimes.ts
  real Node network-stream proof
```

### M13 verification

M13 is verified at the in-process, static-artifact, and real-runtime boundaries. The checks prove early shell delivery, ordered later chunks, final dehydrated Todo query state, Web-stream cancellation tearing down the RxJS source, generic post-start error handling, complete buffered reuse for SSG, and the same progressive behavior through the actual Node HTTP adapter.

### What M13 establishes

M13 adds the final delivery dimension to the original roadmap:

```text
                            ┌── buffered request-time SSR
route/data/JSX/rendering ───┼── progressive request-time SSR
                            └── buffered build-time SSG
```

Only delivery policy changes. **RxJS can own temporal server rendering while the renderer remains pure and the Web platform owns transport.**

## M14 — Functional Component Algebra

M14 makes functional component composition the default application-level view model of `rxjs-fullstack` while preserving the low-level JSX machinery established by M01.

Before M14, the JSX runtime exposed one generic function-component type:

```text
Component<Props>
      │
      ▼
   ViewChild
```

That representation is useful as a JSX implementation primitive, but it says very little about the architecture of an application. M14 therefore gives the two responsibilities distinct names:

```ts
type JsxComponent<Props> =
  (props: Props & { readonly children?: readonly ViewChild[] }) => ViewChild;

interface ComponentProps<Model, Message> {
  readonly model: Model;
  readonly messages: MessageSink<Message>;
}

type Component<Model, Message> =
  JsxComponent<ComponentProps<Model, Message>>;
```

`JsxComponent<Props>` is now the low-level `Props → ViewChild` primitive understood by the JSX runtime. `Component<Model, Message>` is the canonical application component: it receives current model data, may emit application messages, and produces the exact same `ViewChild` representation consumed by the existing DOM, HTML, SSR, SSG, and streaming renderers.

The important relationship is:

```text
Component<Model, Message>
        IS A
JsxComponent<ComponentProps<Model, Message>>
```

M14 is therefore primarily an architectural/type-level promotion, not a second component runtime.

### Components have a one-way message boundary

Application components receive a minimal sink:

```ts
interface MessageSink<Message> {
  next(message: Message): void;
}
```

A component may push a message outward. It does not own RxJS error/completion channels, subscription policy, effect execution, concurrency, or cancellation.

An RxJS `Subject<Message>` is structurally compatible with this boundary, so the workflow composition root can connect a component directly to an RxJS source without coupling the component algebra itself to Subject construction.

M14 applies the same precision to DOM events. The JSX runtime's event type is narrowed from a full RxJS `Observer<Event>` to the `next`-only `EventSink<Event>` contract the renderer actually uses. The renderer still performs the same operation:

```text
DOM event
   ↓
observer.next(event)
```

No event lifecycle semantics were added to rendering.

### The initial Component Algebra is deliberately small

M14 introduces four compositional operations in `src/component.ts`.

`mapModel` changes what model a child component sees:

```text
Component<InnerModel, Message>
          │
          │ mapModel(select)
          ▼
Component<OuterModel, Message>
```

The selector is an ordinary application/domain function. The component combinator only rewires the model boundary.

`mapMessage` changes the message vocabulary emitted by a child:

```text
Component<Model, InnerMessage>
          │
          │ mapMessage(project)
          ▼
Component<Model, OuterMessage>
```

`mapMessageWithModel` performs the same lift when constructing the outer message also requires the current model, for example when an item-local edit must be tagged with that item's identity:

```text
InnerMessage + Model
        │
        ▼
   OuterMessage
```

`list` lifts one item component over a readonly collection while preserving item order:

```text
Component<Item, Message>
          │
          │ list
          ▼
Component<readonly Item[], Message>
```

These combinators compose view structure. They do not introduce time, subscription, scheduling, effects, or hidden state.

### The Component Algebra complements the RxJS Operator Algebra

M14 makes the architectural symmetry explicit:

```text
Component Algebra                     RxJS Operator Algebra
─────────────────                     ─────────────────────
Component<A, X>                        Observable<A>
      │                                     │
   mapModel                                map
      │                                     │
      ▼                                     ▼
Component<B, X>                        Observable<B>

Component<A, X>                        Observable<A>
      │                                     │
 mapMessage                              filter / scan / ...
      │                                     │
      ▼                                     ▼
Component<A, Y>                        Observable<...>
```

The two algebras operate on different dimensions:

```text
Component Algebra = view structure
RxJS Operator Algebra = values moving through time
Domain functions = application meaning
```

This gives the framework a compact responsibility model:

```text
JSX    = View Structure
Domain = Application Meaning
RxJS   = Workflow / Dataflow
```

### The Todos vertical slice is the executable proof

The Todo list now begins with a component over one domain value:

```text
TodoItem
Component<Todo, never>
```

`list(TodoItem)` lifts it over a collection, and `mapModel(selectTodos)` focuses it from `TodosModel` to `readonly Todo[]`. `TodoList` then adds the `<ul>` JSX structure without changing the model or message vocabulary.

The form demonstrates the opposite boundary. `SubmitTodoForm` locally emits a `SubmitEvent`:

```text
Component<void, SubmitEvent>
```

`mapMessage(toSubmitTodoMessage)` lifts that browser package into the application's `TodoMessage` vocabulary:

```text
SubmitEvent
    ↓
toSubmitTodoMessage
    ↓
TodoMessage
```

The component does not decide what happens next.

The workflow root creates:

```ts
const messages$ = new Subject<TodoMessage>();
```

and the existing RxJS pipeline remains visible:

```text
messages$
   ↓
filter(isSubmitTodoMessage)
   ↓
map(message => message.event)
   ↓
tap(preventFormNavigation)
   ↓
exhaustMap(...)
   ↓
server action
   ↓
concatMap(query invalidation)
```

`exhaustMap` still means **ignore while busy**. `concatMap` still sequences invalidation after the write. Query/Cache still owns reads. The server action remains cold/cancellable. M14 does not move any of those temporal policies into the component abstraction.

### Low-level JSX components remain useful

Not every JSX function needs a model/message protocol. Static or infrastructure-oriented functions such as a logo, field fragment, route shell, or resource/workflow composition root can remain:

```text
JsxComponent<Props>
```

Application views that participate in model/message composition use:

```text
Component<Model, Message>
```

Both return `ViewChild`, so both can appear in the same JSX tree and both use the same renderer.

This means M14 does not force presentational helpers into an artificial application protocol merely to make them renderable.

### SSR, SSG, DOM rendering, and streaming do not change

The crucial compatibility invariant is:

```text
JsxComponent<Props> ───────────────┐
                                   ├──► ViewChild
Component<Model, Message> ─────────┘
```

Everything after `ViewChild` remains the M01–M13 machinery:

```text
ViewChild
   ├── DOM mount / RxJS bindings
   ├── pure renderToString()
   ├── buffered SSR
   ├── progressive SSR
   └── SSG
```

No renderer needs to know whether a `ViewChild` was produced by a generic JSX helper or by the Component Algebra.

### M14 source map

```text
src/jsx/runtime.ts
  JsxComponent<Props>
  EventSink<Event>
  unchanged ViewChild representation

src/component.ts
  MessageSink<Message>
  ComponentProps<Model, Message>
  Component<Model, Message>
  mapModel()
  mapMessage()
  mapMessageWithModel()
  list()

src/examples/todos.tsx
  TodoItem and TodoList Component composition
  SubmitTodoForm → TodoMessage composition
  messages$ workflow boundary
  visible RxJS concurrency/effect pipeline

scripts/verify-components.tsx
  mapModel verification
  mapMessage verification
  mapMessageWithModel verification
  list ordering/shape verification

package.json
  verify:components
  M14 verifier in the complete check gate
```

### M14 verification

The dedicated component-algebra verifier proves that:

- `mapModel` projects an outer model into the child model without changing the message channel,
- `mapMessage` lifts a local message into an outer vocabulary,
- `mapMessageWithModel` can construct an outer message from both the local message and current model,
- `list` renders one child for every collection item and preserves order.

The project-wide `bun run check` additionally typechecks the Todos integration and reruns every M01–M13 verifier, SSR/static/runtime build, and browser bundle. This protects the central M14 compatibility claim: the new default application component model must compose with the existing framework rather than replace it.

### What M14 establishes

M14 adds the missing structural counterpart to the RxJS execution model:

```text
                        Domain Values
                             │
                 ┌───────────┴───────────┐
                 ▼                       ▼
        Component Algebra         RxJS Operator Algebra
      Component<Model, Msg>         Observable<A>
                 │                       │
                 ▼                       ▼
          View Structure           Workflow / Dataflow
                 │                       │
                 └───────────┬───────────┘
                             ▼
                        Application
```

The broader principle is: **JSX describes the view, domain functions provide application meaning, and RxJS is the workflow/dataflow engine.**

## What M01–M14 establish

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
M11  Persistent database effects enter through injected RxJS repository ports.
M12  Server-side identity and sessions control route access without a client auth machine.
M13  RxJS server values can be delivered progressively without changing the pure renderer.
M14  Component algebra composes view structure while RxJS composes workflow through time.
```

The completed architecture is:

```text
Domain types + pure functions
      │
      ├──────────────────────────────┐
      │                              │
      ▼                              ▼
Component<Model, Message>      RxJS Operator Algebra
      │                              │
      │ JSX structure                │ workflow/dataflow
      ▼                              │
framework ViewChild                  │
      │                              │
      ├──────────────────────────────┘
      ↓
file-discovered rxjs-router tree
      ↓
request/build route context
      ├── QueryClient
      ├── fetch boundary
      └── ResolvedAuthSession | null
      ↓
route loaders / effects
      ├── Query/Cache reads
      ├── server actions
      ├── repository persistence
      ├── authentication / authorization
      └── optional stream$: Observable<ViewChild>
      ↓
resolved ViewChild values
      ↓
pure renderToString()
      ↓
                    delivery policy
      ┌──────────────────┼────────────────────┐
      ▼                  ▼                    ▼
buffered SSR       progressive SSR            SSG
complete string    Web ReadableStream          complete file
      │                  │                    │
      └──────────────────┼────────────────────┘
                         ▼
                    Web Response / HTML
                         │
              ┌──────────┼──────────┐
              ▼          ▼          ▼
             Bun       Node.js   fetch-native
                                  edge runtime
```

The original M01–M13 fullstack roadmap remains intact; M14 adds the canonical functional view-composition model on top of that completed execution stack.

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

The Bun composition uses one persistent PGlite database for both Todos and authentication. By default its data is stored under:

```text
./.rxjs-fullstack-db
```

Use `DATABASE_PATH` to select another filesystem location:

```sh
DATABASE_PATH=./data/dev-postgres bun run dev:bun
```

### Browser Todos sample

```sh
bun run dev:todos
```

This builds `dist/client/todos-client.js` and serves it on `http://localhost:3100` from a minimal mount page, with the same Hono application handling `/api` and `/api/actions` on that origin. The sample mounts a router-driven shell (`src/examples/todos-shell.tsx`): `router.state$` is the live view source, and nav link clicks flow through an RxJS dataflow into `router.navigateHref()`, so Home, About, Counter, Todos, and Hello navigate client-side without page reloads. The Todos page composes its application view with M14 `Component<Model, Message>` values, drives reads through the M05 Query/Cache layer, and runs the M07 create-todo workflow through visible RxJS operators. The harness serves the mount page on those page routes too, so deep links and reloads stay in the client app.

### Component Algebra verification

```sh
bun run verify:components
```

This verifies the core `mapModel`, `mapMessage`, `mapMessageWithModel`, and `list` composition laws exercised by the M14 implementation.

### Node.js runtime

```sh
bun run start:node
```

This generates routes, builds `dist/runtime/node.js`, and launches it under Node.js. `PORT` overrides the default `3000` port, and `DATABASE_PATH` overrides the default database location.

For example:

```sh
PORT=8080 DATABASE_PATH=./data/node-postgres bun run start:node
```

### Database verification

```sh
bun run verify:database
```

This uses a temporary filesystem database and proves cold repository effects, migration/seed behavior, persistence across reopen, HTTP reads, and server-action writes.

### Authentication verification

```sh
bun run verify:auth
```

This verifies the cold auth service, password hashing, opaque session storage, cookie policy, CSRF-protected logout, protected SSR routing, and persistent users/sessions.

### Streaming SSR verification

```sh
bun run verify:streaming
```

This proves early shell delivery, ordered RxJS server chunks, final Query/Cache dehydration, cancellation teardown, generic post-start error handling, and buffered reuse of the same streaming route.

### Static site generation

```sh
bun run build:static
```

Generated concrete pages are written under `dist/static/`.

The current automatic static set is:

```text
/
/about
/counter
/login
/register
/streaming
/todos
```

`/account/$section` is protected and parameterized, so it remains intentionally excluded by M09's automatic static-route rule.

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
GET  /streaming
GET  /login
GET  /register
GET  /account/:section
GET  /hello/:name
GET  /api/todos
POST /api/actions/todos.create
POST /auth/register
POST /auth/login
POST /auth/logout
GET  /auth/session
```

The dynamic `/hello/:name` page is part of the generated route tree (`src/routes/hello.tsx`). The earlier standalone typed-routing experiment (`src/router/`, `src/examples/routes.tsx`) has been removed; the verification script proves the same typed-params and typed-URL guarantees directly against `rxjs-router`'s `PathParams` and `buildPath()`.

## Development collaboration

`rxjs-fullstack` is being developed collaboratively by **hansschenker** and **ChatGPT by OpenAI**.

ChatGPT has been the primary AI implementation collaborator for architecture refinement, TypeScript/RxJS implementation, verification, documentation, and repository workflow, while project direction and architectural goals are defined and reviewed by hansschenker.

See [`CONTRIBUTORS.md`](./CONTRIBUTORS.md) for the project contributor list.

## Architectural rule

The project should add only coordination that the underlying technologies do not already provide. `Component<Model, Message>` composes application view structure, RxJS remains visible as the workflow/dataflow machine, domain functions carry application meaning, JSX produces framework `ViewChild` values, `rxjs-router` owns routing semantics, Hono owns HTTP and response delivery, repository ports own persistence contracts, authentication is resolved server-side before protected routing, Web Streams own progressive byte transport, runtime composition roots select concrete dependencies, and Bun remains the reference development/build tool rather than framework semantics.
