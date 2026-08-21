# RxJS Fullstack

`rxjs-fullstack` is an experiment in a minimal fullstack web framework whose application execution model is RxJS.

The framework is deliberately small. Existing web-community technologies keep their own responsibilities:

- **TypeScript** — language, strong typing, and JSX compilation.
- **RxJS 7** — lazy dataflows, state, effects, cancellation, sharing, and later query caching.
- **TypeScript JSX** — React-like component syntax without React.
- **Hono** — Web-API HTTP layer.
- **Bun** — reference runtime for the first implementation.

The planned framework capabilities are file-based routing, SSR, SSG, and Query/Cache.

## First vertical slice: M01–M04

### M01 — TypeScript JSX runtime

TypeScript compiles TSX calls to the framework's own `jsx()` function. There is no React dependency or React runtime. JSX produces a small view representation consisting of elements, fragments, primitives, and live Observable children.

### M02 — RxJS DOM bindings

The DOM renderer accepts Observables directly in child and attribute positions. Subscribing happens when a view is mounted. `mount()` returns an RxJS `Subscription`; unsubscribing removes event listeners, child subscriptions, attribute subscriptions, and the mounted DOM.

DOM events are wired into RxJS through `Observer`s. For example, a `Subject<MouseEvent>` can be passed as the `click` observer. The JSX layer does not own application state.

### M03 — HTML renderer and basic SSR

The HTML renderer is intentionally pure and synchronous. It does **not** subscribe to Observable children. Server-side data is resolved by the request's RxJS pipeline before the resulting JSX view is passed to `renderToString()`.

This makes the execution boundary explicit:

```text
HTTP request
    ↓
subscribe to cold RxJS route dataflow
    ↓
resolved values
    ↓
TypeScript JSX view
    ↓
pure HTML renderer
    ↓
HTML response
```

### M04 — Hono + Bun

Hono owns HTTP routing. Bun is only the reference runtime. The Hono application is kept separate from the Bun entry point so another runtime can later adapt the same Web-API application.

## Development collaboration

`rxjs-fullstack` is being developed collaboratively by **hansschenker** and **ChatGPT by OpenAI**.

ChatGPT has been the primary AI implementation collaborator for the project, contributing substantially to architecture refinement, TypeScript and RxJS implementation, tests, documentation, and repository workflow while the project direction and architectural goals are defined and reviewed by hansschenker.

The M01–M05 work was developed with **ChatGPT using GPT-5.6 Sol**. Model attribution is recorded by milestone so future work can remain accurate if a different model is used later.

See [`CONTRIBUTORS.md`](./CONTRIBUTORS.md) for the project contributor list.

## Run

```sh
bun install
bun run check
bun run dev
```

Then open `http://localhost:3000`.

## Architectural rule

The project should add only coordination that the underlying technologies do not already provide. RxJS remains visible as the application machine; JSX is view syntax, Hono is HTTP, and Bun is a runtime rather than framework semantics.
