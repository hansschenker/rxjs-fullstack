
export interface HomeModel {
  readonly title: string;
  readonly milestone: string;
}

export const HomePage = ({ title, milestone }: HomeModel) => (
  <main>
    <h1>{title}</h1>
    <p>{milestone}</p>
    <ul>
      <li>M01 — TypeScript JSX runtime</li>
      <li>M02 — RxJS DOM bindings</li>
      <li>M03 — HTML renderer and basic SSR</li>
      <li>M04 — Hono + Bun server</li>
    </ul>
  </main>
);
