import { invokeServerAction$ } from '../actions/action';
import { createTodoAction } from '../actions/todos';
import type { CreateTodoInput, Todo } from '../domain/todos';
import { queryOptions } from '../query';

export type { CreateTodoInput, Todo } from '../domain/todos';

export type QueryFetch = (input: string, init?: RequestInit) => Promise<Response>;

const browserFetch: QueryFetch = (input, init) => fetch(input, init);

export const createTodosQuery = (fetcher: QueryFetch = browserFetch) =>
  queryOptions({
    queryKey: ['todos'] as const,
    staleTime: 30_000,
    queryFn: async ({ signal }): Promise<readonly Todo[]> => {
      const response = await fetcher('/api/todos', { signal });
      if (!response.ok) {
        throw new Error(`GET /api/todos failed: ${response.status}`);
      }
      return (await response.json()) as readonly Todo[];
    },
  });

export const todosQuery = createTodosQuery();

export const createTodo$ = (input: CreateTodoInput) => invokeServerAction$(createTodoAction, input);
