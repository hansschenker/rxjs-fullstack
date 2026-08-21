import { queryOptions } from '../query';

export interface Todo {
  readonly id: number;
  readonly title: string;
  readonly done: boolean;
}

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

export const createTodo = async (title: string): Promise<Todo> => {
  const response = await fetch('/api/todos', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  if (!response.ok) {
    throw new Error(`POST /api/todos failed: ${response.status}`);
  }
  return (await response.json()) as Todo;
};
