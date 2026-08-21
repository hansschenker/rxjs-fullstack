import { Hono } from 'hono';

import type { Todo } from '../queries/todos';

let nextTodoId = 3;
const todos: Todo[] = [
  { id: 1, title: 'Port TanStack Query to RxJS', done: true },
  { id: 2, title: 'Integrate rxjs-query into rxjs-fullstack', done: false },
];

export const api = new Hono();

api.get('/todos', (context) => context.json(todos));

api.post('/todos', async (context) => {
  const body = await context.req.json<{ title?: string }>();
  const title = body.title?.trim();

  if (!title) {
    return context.json({ error: 'title is required' }, 400);
  }

  const todo: Todo = { id: nextTodoId++, title, done: false };
  todos.push(todo);
  return context.json(todo, 201);
});
