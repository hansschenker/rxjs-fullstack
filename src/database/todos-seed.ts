export interface SeedTodo {
  readonly title: string;
  readonly done: boolean;
}

export const seedTodos: readonly SeedTodo[] = [
  { title: 'Port TanStack Query to RxJS', done: true },
  { title: 'Integrate rxjs-query into rxjs-fullstack', done: false },
];
