import { invokeServerAction$ } from '../actions/action';
import { createTodoAction } from '../actions/todos';
import type { CreateTodoInput, Todo } from '../domain/todos';
import { queryOptions } from '../query';

export type { CreateTodoInput, Todo } from '../domain/todos';

export const todosQuery = queryOptions({
  queryKey: ['todos'],
  queryFn: async ({ signal }): Promise<readonly Todo[]> => {
    const response = await fetch('/api/todos', { signal });
    if (!response.ok) {
      throw new Error(`GET /api/todos failed: ${response.status}`);
    }
    return (await response.json()) as readonly Todo[];
  },
});

export const createTodo$ = (input: CreateTodoInput) =>
  invokeServerAction$(createTodoAction, input);
