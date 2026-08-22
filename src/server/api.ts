import { defer, of } from 'rxjs';
import { Hono } from 'hono';

import { createTodoAction } from '../actions/todos';
import { parseCreateTodoInput } from '../domain/todos';
import {
  invalidServerActionInput,
  registerServerAction,
} from './action';
import { addTodo, listTodos } from './todos-store';

export const api = new Hono();
const actions = new Hono();

api.get('/todos', (context) => context.json([...listTodos()]));

registerServerAction(actions, createTodoAction, {
  parse: (value) =>
    parseCreateTodoInput(value) ??
    invalidServerActionInput('A non-empty todo title is required.'),
  run: (input, { signal }) =>
    defer(() => {
      if (signal.aborted) {
        throw new Error('Server action request was aborted.');
      }

      return of(addTodo(input));
    }),
  successStatus: 201,
});

api.route('/actions', actions);
