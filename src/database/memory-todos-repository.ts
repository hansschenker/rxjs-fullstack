import { defer, of } from 'rxjs';

import type { CreateTodoInput, Todo } from '../domain/todos';
import {
  type RepositoryOperationOptions,
  type TodoRepository,
  throwIfRepositoryOperationAborted,
} from './todos-repository';
import { seedTodos } from './todos-seed';

export const createMemoryTodoRepository = (): TodoRepository => {
  const todos: Todo[] = seedTodos.map((todo, index) => ({
    id: index + 1,
    ...todo,
  }));
  let nextTodoId = todos.length + 1;

  return {
    list$: (options?: RepositoryOperationOptions) =>
      defer(() => {
        throwIfRepositoryOperationAborted(options?.signal);
        return of(todos.map((todo) => ({ ...todo })));
      }),
    create$: ({ title }: CreateTodoInput, options?: RepositoryOperationOptions) =>
      defer(() => {
        throwIfRepositoryOperationAborted(options?.signal);
        const todo: Todo = { id: nextTodoId++, title, done: false };
        todos.push(todo);
        return of({ ...todo });
      }),
    close: async () => undefined,
  };
};
