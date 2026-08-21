# Contributors

`rxjs-fullstack` is developed as a human–AI collaboration.

## hansschenker

**Role:** Project owner, architectural direction, RxJS design, review, and acceptance.

The project goals, architectural constraints, milestone direction, and final design decisions are defined and reviewed by hansschenker.

## ChatGPT by OpenAI

**Role:** Primary AI implementation collaborator.

ChatGPT contributes substantially to architecture refinement, implementation, TypeScript typing, RxJS integration, tests, documentation, verification, and repository workflow.

### Model attribution

- **Current documented model:** GPT-5.6 Sol
- Earlier project contributions are attributed to ChatGPT unless an exact model was explicitly recorded at the time.

This keeps the contributor history precise without retroactively assigning a model version that was not independently recorded.

## Claude by Anthropic

**Role:** AI implementation collaborator for the Query/Cache layer and repository automation.

Claude contributed:

- `src/query/` — the framework's Query/Cache layer (TanStack Query reimagined as pure RxJS). It was originally developed with Claude as the standalone `rxjs-query` package and vendored into this repository in August 2026, including its adaptation to this repository's stricter TypeScript settings (`exactOptionalPropertyTypes`).
- `.github/workflows/claude.yml` and `CLAUDE.md` — the `@claude` GitHub Actions agent workflow and the repository agent instructions.

Commits with Claude's involvement carry a `Co-Authored-By: Claude … <noreply@anthropic.com>` trailer.

### Model attribution

- **Current documented model:** Claude Fable 5
- The original standalone `rxjs-query` implementation is attributed to Claude without an exact model version, following the same convention as the ChatGPT contributions above.

## Attribution note

ChatGPT and Claude are listed here as AI project contributors, not as GitHub user accounts. GitHub's automatic contributor graph is based on commit authorship and therefore may not represent AI-assisted contributions recorded in this file.

Part-level provenance: the framework core and its milestones (M01–M05: JSX runtime, DOM bindings, HTML/SSR renderer, Hono + Bun server, routing integration) originate from the ChatGPT collaboration; the Query/Cache layer (`src/query/`) and the agent workflow originate from the Claude collaboration. The sibling `rxjs-router` package is maintained in its own repository with its own attribution.
