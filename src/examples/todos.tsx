import {
  Subject,
  catchError,
  exhaustMap,
  filter,
  map,
  of,
  startWith,
} from 'rxjs';
import { QueryClient } from '@netxpert/rxjs-query';

import { Fragment, jsx, type ViewChild } from '../jsx/runtime';
import { createTodo, todosQuery, type Todo } from '../queries/todos';

export const queryClient = new QueryClient();

export const TodoApp = () => {
  const addClick$ = new Subject<MouseEvent>();

  const addTodo = queryClient.mutation<Todo, Error, string>({
    mutationFn: createTodo,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: todosQuery.queryKey });
    },
  });

  const list$ = queryClient.query$(todosQuery).pipe(
    map((result): ViewChild => {
      if (result.isLoading) {
        return <p>Loading todos...</p>;
      }

      if (result.isError) {
        return <p>Failed to load todos.</p>;
      }

      return (
        <ul>
          {result.data?.map(
            (todo): ViewChild => (
              <li>
                {todo.done ? '✓ ' : '○ '}
                {todo.title}
              </li>
            ),
          ) ?? null}
        </ul>
      );
    }),
  );

  // Declarative mutation wiring: the status line observes the click stream,
  // so subscribing the view is what drives the mutation. exhaustMap ignores
  // clicks while a save is in flight.
  const status$ = addClick$.pipe(
    map(() => document.querySelector<HTMLInputElement>('#new-todo')),
    filter(
      (input): input is HTMLInputElement =>
        input !== null && input.value.trim().length > 0,
    ),
    exhaustMap((input) => {
      const title = input.value.trim();
      input.value = '';
      return addTodo.mutate$(title).pipe(
        map(() => ''),
        startWith('Saving...'),
        catchError(() => of('Failed to save.')),
      );
    }),
    startWith(''),
  );

  return (
    <section>
      <h2>Todos</h2>
      <p>
        Fetched with rxjs-query: cached, deduped, and refetched after every
        mutation.
      </p>
      {list$}
      <input id="new-todo" type="text" placeholder="What needs doing?" />
      <button type="button" on={{ click: addClick$ }}>
        Add
      </button>
      <p>{status$}</p>
    </section>
  );
};
