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
