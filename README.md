<p align="center">
  <img src="./assets/rxjs-fullstack-logo.webp" alt="RxJS Fullstack logo" width="360" />
</p>

# RxJS Fullstack

`rxjs-fullstack` is an experiment in a minimal fullstack web framework whose application execution model is RxJS.

The framework is deliberately small. Existing web-community technologies keep their own responsibilities:

- **TypeScript** — language, strong typing, and JSX compilation.
- **RxJS 7** — lazy dataflows, state, effects, cancellation, sharing, and later query caching.
- **TypeScript JSX** — React-like component syntax without React.
- **Hono** — Web-API HTTP layer.
- **Bun** — reference runtime for the first implementation.

The planned framework capabilities are file-based routing, SSR, SSG, and Query/Cache.
Routing and route data resolution are provided by the sibling `rxjs-router`
package.

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

In the original M03–M04 vertical slice, the home-page request pipeline was built directly in the server module: `defer()` created a cold request dataflow, the resolved model was mapped through `HomePage`, then through `renderToString`, and finally through `renderDocument`. M05 keeps the same execution rule but moves this repeated route machinery behind the typed routing abstraction.

Because rendering is just a pure function inside the RxJS pipeline, the renderer does not hide execution, concurrency, cancellation, or subscription policy. RxJS remains responsible for how and when server data is produced; the HTML renderer is responsible only for turning an already resolved view into text.

The verification script also checks this boundary: the SSR Observable has zero executions before subscription, executes once when consumed, and Observable children are rejected if they reach the HTML renderer unresolved.

The core implementation lives in `src/render/html.ts`.

### M04 — Hono + Bun server

M04 completes the first vertical slice by connecting the RxJS SSR pipeline to an HTTP server.

Hono owns HTTP routing. The application exposes a health endpoint and SSR page routes. In the first vertical slice, the root route directly consumed the cold home-page dataflow with `firstValueFrom()`. This established the explicit boundary where an HTTP request asks an RxJS dataflow for the response value.

M05 later centralizes that same boundary inside `registerPageRoute()`, so route-specific code no longer has to repeat the subscription and rendering bridge.

The server application and runtime adapter remain intentionally separate:

- `src/server/app.tsx` defines the Web-API Hono application and registers framework routes.
- `src/server/bun.ts` is only the Bun adapter: it supplies port `3000` and forwards Bun's `fetch` handling to `app.fetch`.

That split means Bun is not framework semantics. A later Node, Deno, Cloudflare, or other Web-API-compatible adapter can host the same Hono application without changing the JSX runtime, RxJS execution model, HTML renderer, or route definitions.

M04 therefore proves the end-to-end server path:

```text
request
  → Hono route
  → cold RxJS dataflow
  → typed model
  → JSX
  → HTML
  → Hono Response
  → Bun
```

The verification script calls the Hono application directly, checks the root SSR response, checks the health endpoint, and confirms that the full M01–M04 path works without requiring a separately running HTTP server.

## M05 — Strongly typed routing

M05 turns the first server slice into reusable framework infrastructure while keeping RxJS visible as the execution model.

The central rule is: **declare a route once and derive as much TypeScript information as possible from that declaration.**

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

### Typed page route

A page route combines the values and functions that belong to one page:

- a literal route path,
- a path-derived `RouteParams<Path>` type,
- a typed `RouteLoadContext<Path>`,
- a loader returning `Observable<Model>`,
- a view function from `Model` to JSX,
- typed page metadata such as `title`,
- and a typed `href(...)` helper for URL construction.

A route therefore looks like normal strongly typed TypeScript while preserving an explicit RxJS loader:

```tsx
export const helloRoute = definePageRoute('/hello/:name')({
  load: ({ params }) =>
    of({
      name: params.name,
    }),

  view: ({ name }) => (
    <main>
      <h1>Hello {name}</h1>
      <p>The route parameter was inferred from the path literal.</p>
    </main>
  ),

  title: ({ name }) => `Hello ${name}`,
});
```

What flows through the server route is:

```text
literal path
    ↓
inferred route params
    ↓
typed RouteLoadContext
    ↓
cold Observable<Model>
    ↓
typed Model
    ↓
view(Model)
    ↓
JSX
    ↓
renderToString()
    ↓
HTML document
    ↓
HTTP response
```

The loader deliberately returns `Observable<Model>` rather than `Promise<Model>`. The route is therefore still an RxJS dataflow description: execution remains lazy until the HTTP integration subscribes to it.

### Hono integration boundary

`registerPageRoute(app, route)` is the framework boundary between Hono's runtime route matching and the strongly typed application route.

Hono performs the actual HTTP path match. Its string-keyed runtime params are lifted once into the TypeScript type derived from the route path. Above that boundary, application code works with strongly typed params rather than untyped strings indexed by arbitrary names.

The route adapter then creates the request dataflow with `defer()`, lets the typed loader produce `Observable<Model>`, maps the model through the view and HTML renderers, and finally uses `firstValueFrom()` at the HTTP boundary to produce the Hono response.

This keeps the responsibilities explicit:

```text
Hono
  runtime path matching
        ↓
rxjs-fullstack route boundary
  typed params + request context
        ↓
RxJS
  loader Observable<Model>
        ↓
JSX / HTML renderers
        ↓
Hono Response
```

### Typed URL construction

Strong typing also works in the opposite direction when application code creates a URL.

Each route exposes a typed `href()` function:

```ts
helloRoute.href({ name: 'Erik Meijer' });
```

which produces:

```text
/hello/Erik%20Meijer
```

TypeScript rejects missing or unrelated parameters:

```ts
helloRoute.href({});          // compile-time error
helloRoute.href({ id: 'Erik' }); // compile-time error
```

This means the literal path drives both sides of routing:

```text
                  '/hello/:name'
                         │
              ┌──────────┴──────────┐
              ▼                     ▼
       incoming request       outgoing URL
              │                     │
              ▼                     ▼
     params.name: string    href({ name: string })
              │
              ▼
       Observable<Model>
```

### Current server registration

With M05, `src/server/app.tsx` becomes a thin server composition point rather than the place where each page's RxJS/SSR pipeline is manually assembled:

```ts
export const app = new Hono();

app.get('/health', (context) => context.json({ ok: true }));

registerPageRoute(app, homeRoute);
registerPageRoute(app, helloRoute);
```

The current dynamic proof route is:

```text
/hello/:name
```

Its inferred `params.name` flows into the loader model, the JSX view, the generated HTML, and the document title.

The core M05 implementation lives in:

- `src/router/route.ts` — route types, path-param inference, registration, and typed URL construction,
- `src/examples/routes.tsx` — typed home and dynamic route definitions,
- `src/server/app.tsx` — Hono composition and route registration,
- `scripts/verify.tsx` — compile-time and runtime verification.

The verification includes both runtime SSR checks and compile-time assertions using `@ts-expect-error`, ensuring that missing or incorrectly named route parameters really are rejected by TypeScript.

## What M01–M05 establish

Together these milestones establish the minimum architectural skeleton of `rxjs-fullstack`:

```text
M01  JSX is a typed description of a view.
M02  Browser execution is owned by RxJS Subscriptions.
M03  Server rendering is a pure step inside an RxJS dataflow.
M04  HTTP and runtime concerns remain thin adapters around that dataflow.
M05  Routes are declared once and become strongly typed RxJS page pipelines.
```

The architectural progression is now:

```text
TypeScript JSX
      ↓
framework ViewChild
      ↓
RxJS browser bindings / pure SSR renderer
      ↓
strongly typed RxJS routes
      ↓
Hono HTTP boundary
      ↓
Bun runtime
```

The first five milestones therefore demonstrate the project's central rule: **RxJS is the application machine; the surrounding technologies keep their existing jobs.**

## Development collaboration

`rxjs-fullstack` is being developed collaboratively by **hansschenker** and **ChatGPT by OpenAI**.

ChatGPT has been the primary AI implementation collaborator for the project, contributing substantially to architecture refinement, TypeScript and RxJS implementation, tests, documentation, and repository workflow while the project direction and architectural goals are defined and reviewed by hansschenker.

The current documented ChatGPT model is **GPT-5.6 Sol**. Earlier project work remains attributed to ChatGPT unless an exact model was explicitly recorded at the time; this avoids retroactively assigning a model version that was not independently recorded.

See [`CONTRIBUTORS.md`](./CONTRIBUTORS.md) for the project contributor list.

### M05 — rxjs-router integration

Route definitions live in `src/routes.tsx` and are shared by the server and the
browser. The server uses `resolveRequest()` before passing a resolved JSX view to
the pure HTML renderer. The browser uses `createBrowserHistory()` and
`router.state$` as the live application view source for the DOM renderer.

Route modules live under `src/routes/`. Each page module exports a route object,
and `src/routes.tsx` is the manual barrel that assembles the route tree. This
keeps route files small today and leaves room for a later file-route generator.

## Run

```sh
bun install
bun run check
bun run dev
```

Then open `http://localhost:3000`.

The current server routes include:

```text
GET /health
GET /
GET /hello/:name
```

For example, open `http://localhost:3000/hello/Erik` to exercise the M05 dynamic typed SSR route.

## Architectural rule

The project should add only coordination that the underlying technologies do not already provide. RxJS remains visible as the application machine; JSX is view syntax, Hono is HTTP, and Bun is a runtime rather than framework semantics.
