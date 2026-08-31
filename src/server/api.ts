import { firstValueFrom } from 'rxjs';
import { Hono } from 'hono';

import { createTodoAction } from '../actions/todos';
import type { TodoRepository } from '../database/todos-repository';
import { parseCreateTodoInput } from '../domain/todos';
import { invalidServerActionInput, registerServerAction } from './action';

export interface CreateApiOptions {
  readonly todosRepository: TodoRepository;
}

export const createApi = ({ todosRepository }: CreateApiOptions) => {
  const api = new Hono();
  const actions = new Hono();

  api.get('/todos', async (context) => {
    const todos = await firstValueFrom(todosRepository.list$({ signal: context.req.raw.signal }));
    return context.json([...todos]);
  });

  registerServerAction(actions, createTodoAction, {
    parse: (value) =>
      parseCreateTodoInput(value) ??
      invalidServerActionInput('A non-empty todo title is required.'),
    run: (input, { signal }) => todosRepository.create$(input, { signal }),
    successStatus: 201,
  });

  api.route('/actions', actions);
  return api;
};
