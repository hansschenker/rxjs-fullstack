import { defineServerAction } from './action';
import type { CreateTodoInput, Todo } from '../domain/todos';

export const createTodoAction = defineServerAction<CreateTodoInput, Todo>('todos.create');
