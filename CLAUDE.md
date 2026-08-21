# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An experimental minimal fullstack framework whose execution model is RxJS: TypeScript JSX (no React) describes views, RxJS owns state/effects/cancellation, Hono owns HTTP, Bun hosts the app. The README is the design document — it narrates the milestones (M01 JSX runtime, M02 DOM bindings, M03 HTML/SSR renderer, M04 Hono+Bun server, M05 routing) and the reasoning behind each boundary. Read the relevant milestone section before changing that layer.

The Query/Cache layer lives in `src/query/` — TanStack Query reimagined as pure RxJS. It was vendored from the formerly standalone `rxjs-query` package and is now part of the framework, published with it; do not reintroduce it as an external dependency. App-level query definitions (e.g. the todos query) live in `src/queries/`. The vendored module's vitest suite was not ported — behavior checks for it belong in `scripts/verify.tsx`.

## Commands

- `bun run check` — typecheck + verify + build both example clients. **This must pass before any change counts as done.**
- `bun run verify` — runs `scripts/verify.tsx`, the executable spec (laziness, single-execution, SSR Observable rejection, etc.). New invariants belong here.
- `bun run typecheck` — `tsc --noEmit`.
- `bun run dev` — hot-reload dev server on port 3000 (`src/server/bun.ts`).
- `bun run build:client` / `bun run build:todos` — bundle the example clients to `dist/client`.

## CI environment setup (GitHub Actions agent runs)

The runner starts without Bun and without the sibling repo that `package.json` references via a `file:` path. Bootstrap before installing:

```bash
# 1. Bun
curl -fsSL https://bun.sh/install | bash
export PATH="$HOME/.bun/bin:$PATH"

# 2. Sibling (must sit NEXT TO this repo's checkout)
git clone --depth 1 https://github.com/hansschenker/rxjs-router ../rxjs-router   # ships dist/, works as-is

# 3. Install and verify
bun install
bun run check
```

## Architecture invariants (enforce these in every change and review)

- **The HTML renderer never subscribes.** `renderToString()` (`src/render/html.ts`) is a pure function; Observable children/attributes reaching it are a `TypeError` by design. All server async work resolves in the request's RxJS dataflow *before* JSX is rendered.
- **The JSX runtime creates no DOM and owns no lifecycle.** `src/jsx/runtime.ts` only normalizes children into `ViewChild` nodes. Rendering, subscribing, and state live elsewhere.
- **Cancellation has one owner.** `mount(view, container)` (`src/render/dom.ts`) returns the RxJS `Subscription` that is the view's lifetime; unsubscribing must tear down listeners, child subscriptions, and DOM. When an Observable child emits, the previous child's subscription is unsubscribed before the replacement renders.
- **Events flow through Observers, meaning flows through the dataflow.** The renderer forwards DOM events into `on={{ click: subject$ }}` observers; it never interprets them. State machines are explicit RxJS pipelines (`scan`, `startWith`, `shareReplay`).
- **Hono owns HTTP; `src/server/bun.ts` is only the Bun adapter** (port + `fetch` forwarding). Framework routes register through the routing layer (`registerPageRoute()` in `src/server/app.tsx`), not ad-hoc per-route subscription code.
- **No React, ever** — no react/react-dom dependency, no React idioms smuggled in. JSX compiles to the framework's own `jsx()`/`Fragment`.

## Working style

- TypeScript strict; no `any`; 2-space indent, Prettier defaults.
- New capabilities need a corresponding check in `scripts/verify.tsx` — the verify script is the spec, not an afterthought.
- Keep the README's milestone narrative in sync when behavior it describes changes.
- When triggered from an issue (`@claude` mention): work on a branch, open a PR, and report `bun run check` results in the PR body. Do not merge.
