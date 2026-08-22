<p align="center">
  <img src="./assets/rxjs-fullstack-logo.webp" alt="RxJS Fullstack logo" width="360" />
</p>

# RxJS Fullstack

`rxjs-fullstack` is an experiment in a minimal fullstack web framework whose application execution model is RxJS.

The framework is deliberately small. Existing web-community technologies keep their own responsibilities:

- **TypeScript** — language, strong typing, and JSX compilation.
- **RxJS 7** — lazy dataflows, state, effects, cancellation, sharing, and query caching.
- **TypeScript JSX** — React-like component syntax without React.
- **Hono** — Web-API HTTP layer.
- **Bun** — reference runtime for the first implementation.

The framework is growing toward file-based routing, SSR, SSG, and Query/Cache while keeping routing and route data resolution in the sibling `rxjs-router` package.

## First vertical slice: M01–M04

The first vertical slice establishes one complete path through the stack:

```text
TypeScript JSX
    ↓
framework ViewChild representation
    ↓
client DOM renderer or server HTML renderer
    ↓
RxJS request dataflow
    ↓
Hono HTTP response
    ↓
Bun runtime
```

The important architectural result is not only that the pieces work together, but that their responsibilities remain separate. JSX describes the view, RxJS owns temporal execution and state, renderers translate the view, Hono owns HTTP, and Bun only hosts the application.

### M01 — TypeScript JSX runtime

M01 establishes the framework's view language without introducing React or another component runtime.

TypeScript is configured to compile TSX directly to the framework's own `jsx()` function and `Fragment` value. A JSX expression therefore becomes a small framework-owned `ViewChild` representation rather than a React element.

The runtime defines the values that can flow through the view layer:

- primitive values such as strings and numbers,
- intrinsic HTML elements,
- fragments,
- function components,
- nested arrays of children,
- and RxJS Observables as live child values.

Function components stay simple: they are functions from typed props plus children to a `ViewChild`. The JSX runtime normalizes nested children and creates plain tagged element/fragment nodes. It does not create DOM nodes, render HTML, subscribe to Observables, own component state, or introduce a hidden lifecycle.

That separation is important because the same JSX representation can later be interpreted in different environments. M01 therefore gives the project one common view description that both the browser renderer and the server renderer can consume.

The core implementation lives in `src/jsx/runtime.ts`.

### M02 — RxJS DOM bindings

M02 connects the M01 view representation to the browser while keeping RxJS visible as the execution model.

`mount(view, container)` renders a `ViewChild` tree into the DOM and returns an RxJS `Subscription`. That returned Subscription is the lifetime of the mounted view. Mounting starts the live bindings; unsubscribing tears them down.

The DOM renderer handles the different view values directly:

- strings and numbers become text nodes,
- fragments and arrays render their children in place,
- element nodes become real DOM elements,
- ordinary props become DOM attributes,
- Observable props become live attribute bindings,
- and Observable children become live regions in the DOM.

For an Observable child, the renderer inserts start/end marker comments and subscribes when the view is mounted. Every new emitted value replaces the currently rendered contents of that region. Before the replacement is rendered, the previous child-specific Subscription is unsubscribed, so subscriptions and event listeners belonging to the old emitted view are cancelled rather than left alive.

DOM events travel in the opposite direction through RxJS `Observer`s. JSX can declare:

```tsx
<button on={{ click: increment$ }}>...</button>
```

where `increment$` can be a `Subject<MouseEvent>`. The renderer installs the DOM listener and forwards each event with `observer.next(event)`. The renderer does not decide what the click means; the application dataflow does.

The counter example demonstrates that separation. Click events enter a `Subject`, then normal RxJS operators transform the stream into state with `map`, `scan`, `startWith`, and `shareReplay`. The resulting `count$` Observable is placed directly in JSX as a live child. The JSX/DOM layer only moves values between the DOM and the RxJS dataflow; the state machine remains explicit in the application pipeline.

Unsubscribing the Subscription returned by `mount()` removes event listeners, Observable child subscriptions, Observable attribute subscriptions, child-view lifetimes, and the mounted DOM. Cancellation therefore has one explicit owner.

The core implementation lives in `src/render/dom.ts`, with the counter proof in `src/examples/counter.tsx` and `src/examples/counter-client.tsx`.

### M03 — HTML renderer and basic SSR

M03 adds a second interpreter for the same M01 view representation: a pure synchronous HTML renderer for server-side rendering.

`renderToString()` converts resolved JSX values into HTML. It handles primitives, arrays, fragments, normal elements, void elements, boolean attributes, `className` → `class`, and HTML escaping.

The key SSR rule is deliberate: **the HTML renderer never subscribes to an Observable**.

Observable children or Observable attributes are rejected with a `TypeError`. Server-side asynchronous work must therefore be resolved by the request's RxJS dataflow before the JSX value reaches `renderToString()`.

This keeps the execution boundary explicit:

```text
HTTP request
    ↓
subscribe to cold RxJS route dataflow
    ↓
resolve server values
    ↓
map values into TypeScript JSX
    ↓
map JSX through pure renderToString()
    ↓
map body through renderDocument()
    ↓
HTML response
```

In the original M03–M04 vertical slice, the home-page request pipeline was built directly in the server module: `defer()` created a cold request dataflow, the resolved model was mapped through `HomePage`, then through `renderToString`, and finally through `renderDocument`. M05 keeps the same execution rule but moves this repeated route machinery behind the routing abstraction.

Because rendering is just a pure function inside the RxJS pipeline, the renderer does not hide execution, concurrency, cancellation, or subscription policy. RxJS remains responsible for how and when server data is produced; the HTML renderer is responsible only for turning an already resolved view into text.

The verification script also checks this boundary: the SSR Observable has zero executions before subscription, executes once when consumed, and Observable children are rejected if they reach the HTML renderer unresolved.

The core implementation lives in `src/render/html.ts`.

### M04 — Hono + Bun server

M04 completes the first vertical slice by connecting the RxJS SSR pipeline to an HTTP server.

Hono owns HTTP routing. The application exposes a health endpoint and SSR page routes. In the first vertical slice, the root route directly consumed the cold home-page dataflow with `firstValueFrom()`. This established the explicit boundary where an HTTP request asks an RxJS dataflow for the response value.

M05 later centralizes route matching and data resolution through `rxjs-router`, so route-specific code no longer repeats HTTP integration machinery.

The server application and runtime adapter remain intentionally separate:

- `src/server/app.tsx` defines the Web-API Hono application and registers framework routes.
- `src/server/bun.ts` is only the Bun adapter: it supplies port `3000` and forwards Bun's `fetch` handling to `app.fetch`.

That split means Bun is not framework semantics. A later Node, Deno, Cloudflare, or other Web-API-compatible adapter can host the same Hono application without changing the JSX runtime, RxJS execution model, HTML renderer, or route definitions.

M04 therefore proves the end-to-end server path:

```text
request
  → Hono route
  → RxJS/router data resolution
  → typed model
  → JSX
  → HTML
  → Hono Response
  → Bun
```

The verification script calls the Hono application directly, checks the root SSR response, checks the health endpoint, and confirms that the full M01–M04 path works without requiring a separately running HTTP server.

## M05 — Strongly typed routing and Query/Cache

M05 turns the first server slice into reusable framework infrastructure while keeping RxJS visible as the execution model.

The repository contains two complementary routing pieces developed during M05:

- the in-repo typed route experiment in `src/router/`, including path-literal-derived params and typed `href(...)`,
- the running application integration with the sibling `rxjs-router` package, used by both server and browser routing.

The central rule remains: **declare route behavior explicitly and derive as much TypeScript information as possible from that declaration.**

A literal route path such as:

```ts
definePageRoute('/hello/:name')
```

automatically gives the loader a strongly typed parameter object equivalent to:

```ts
{
  readonly name: string;
}
```

There is no separately maintained `Params` interface and therefore no second source of truth that can drift away from the route path.

The same works for multiple parameters. For example:

```ts
type Params = RouteParams<'/teams/:teamId/users/:userId'>;
```

produces the effective type:

```ts
{
  readonly teamId: string;
  readonly userId: string;
}
```

M05 also integrates the framework-owned Query/Cache layer in `src/query/`. The Todo vertical slice uses query definitions under `src/queries/`, browser query streams, mutation streams, invalidation, and a Hono `/api/todos` endpoint. Query behavior remains RxJS dataflow rather than a separate component lifecycle.

### rxjs-router integration

Route definitions are shared by the server and browser. The server uses `resolveRequest()` before passing resolved JSX to the pure HTML renderer. The browser uses `createBrowserHistory()` and `router.state$` as the live application view source for the DOM renderer.

Route modules live under `src/routes/`. Through M05, `src/routes.tsx` manually imported each page route and assembled them under the root route. That manual barrel established the correct module boundary but still required central registration whenever a page file was added.

## M06 — File-based route discovery

M06 removes that manual registration step without moving routing semantics out of `rxjs-router`.

The convention is deliberately small:

- page route modules live in `src/routes/*.tsx`,
- every page module default-exports its `rxjs-router` route object,
- non-page support modules such as `root.ts` and `types.ts` remain ordinary TypeScript files,
- `scripts/generate-routes.ts` discovers the page modules and writes the complete typed route tree to `src/routes.generated.ts`,
- `src/routes.tsx` becomes a stable public re-export rather than a hand-maintained page registry.

The flow is now:

```text
src/routes/*.tsx
      ↓
Bun.Glob discovery
      ↓
sorted page imports
      ↓
generated createRoute({ children: [...] }) root tree
      ↓
src/routes.generated.ts
      ↓
src/routes.tsx public re-export
      ↓
server resolveRequest() / browser createRouter()
```

Generating the root `createRoute()` call together with its inline `children: [...]` tuple is important for TypeScript: `rxjs-router` can preserve the exact const tuple and derive the application route-state types across the whole tree.

The generator does **not** implement route matching, data loading, cancellation, navigation, or URL semantics. Those responsibilities stay in `rxjs-router`. It only performs build-time discovery and assembly—the coordination that the fullstack framework needs around the router.

The generated file is committed so TypeScript, editors, and consumers always see a concrete route tree, but it is regenerated before development, startup, typechecking, verification, and the full `check` command. Route order is deterministic because discovered filenames are sorted before generation.

A new `src/routes/about.tsx` page is the M06 proof. It is never imported by hand in `src/routes.tsx`; the generator discovers it, and `/about` participates in the same SSR route tree as `/`, `/counter`, and `/todos`.

The verification script checks both sides of the invariant:

- `generatedRouteFiles` contains `about.tsx`, proving discovery,
- `GET /about` returns the SSR page, proving that the generated route object actually reached `rxjs-router` and the server pipeline.

M06 also makes the sibling `file:../rxjs-router` bootstrap explicit. The router repository must sit beside `rxjs-fullstack`, and its production dependencies must be installed because Bun's browser bundler resolves runtime imports such as `rxjs` from the sibling package directory. CI now performs the same setup before running `bun run check`.

## What M01–M06 establish

Together these milestones establish the minimum architectural skeleton of `rxjs-fullstack`:

```text
M01  JSX is a typed description of a view.
M02  Browser execution is owned by RxJS Subscriptions.
M03  Server rendering is a pure step inside an RxJS dataflow.
M04  HTTP and runtime concerns remain thin adapters around that dataflow.
M05  Routing plus Query/Cache form reusable RxJS application infrastructure.
M06  Page route modules are discovered and assembled without central manual registration.
```

The architectural progression is now:

```text
TypeScript JSX
      ↓
framework ViewChild
      ↓
RxJS browser bindings / pure SSR renderer
      ↓
file-discovered, strongly typed rxjs-router route tree
      ↓
Query/Cache + application dataflows
      ↓
Hono HTTP boundary
      ↓
Bun runtime
```

The first six milestones therefore demonstrate the project's central rule: **RxJS is the application machine; the surrounding technologies keep their existing jobs.**

## Development collaboration

`rxjs-fullstack` is being developed collaboratively by **hansschenker** and **ChatGPT by OpenAI**.

ChatGPT has been the primary AI implementation collaborator for the project, contributing substantially to architecture refinement, TypeScript and RxJS implementation, tests, documentation, and repository workflow while the project direction and architectural goals are defined and reviewed by hansschenker.

The current documented ChatGPT model is **GPT-5.6 Sol**. Earlier project work remains attributed to ChatGPT unless an exact model was explicitly recorded at the time; this avoids retroactively assigning a model version that was not independently recorded.

See [`CONTRIBUTORS.md`](./CONTRIBUTORS.md) for the project contributor list.

## Run

The sibling router must be available beside this repository because the current package dependency is `file:../rxjs-router`:

```sh
git clone https://github.com/hansschenker/rxjs-router ../rxjs-router
(cd ../rxjs-router && bun install --production)
bun install
bun run check
bun run dev
```

Then open `http://localhost:3000`.

The current server routes include:

```text
GET /health
GET /
GET /about
GET /counter
GET /todos
GET /hello/:name
GET /api/todos
```

For example, open `http://localhost:3000/about` to exercise M06 route discovery, or `http://localhost:3000/hello/Erik` to exercise the earlier typed dynamic route proof.

## Architectural rule

The project should add only coordination that the underlying technologies do not already provide. RxJS remains visible as the application machine; JSX is view syntax, `rxjs-router` owns routing semantics, Hono is HTTP, and Bun is a runtime rather than framework semantics.
