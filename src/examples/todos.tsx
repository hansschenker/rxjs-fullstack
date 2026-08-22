import {
  Subject,
  catchError,
  concatMap,
  exhaustMap,
  map,
  of,
  startWith,
  tap,
} from 'rxjs';
import { QueryClient } from '../query';

import { createTodoInput, type CreateTodoInput } from '../domain/todos';
import { Fragment, jsx, type ViewChild } from '../jsx/runtime';
import { createTodo$, todosQuery, type Todo } from '../queries/todos';

export const queryClient = new QueryClient();

interface TodoSubmission {
  readonly form: HTMLFormElement;
  readonly input: CreateTodoInput;
}

const preventFormNavigation = (event: SubmitEvent): void => {
  event.preventDefault();
};

const readTodoSubmission = (event: SubmitEvent): TodoSubmission | undefined => {
  const form = event.currentTarget;
  if (!(form instanceof HTMLFormElement)) {
    return undefined;
  }

  const title = new FormData(form).get('title');
  if (typeof title !== 'string') {
    return undefined;
  }

  const input = createTodoInput(title);
  return input ? { form, input } : undefined;
};

export const TodoApp = () => {
  const submit$ = new Subject<SubmitEvent>();

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
            (todo: Todo): ViewChild => (
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

  // The form is the event source. exhaustMap is the submit policy: while one
  // server action is in flight, later submits are ignored. Unsubscribing the
  // mounted view tears down this chain; fromFetch then aborts the request.
  const status$ = submit$.pipe(
    tap(preventFormNavigation),
    exhaustMap((event) => {
      const submission = readTodoSubmission(event);
      if (!submission) {
        return of('Enter a todo.');
      }

      return createTodo$(submission.input).pipe(
        concatMap(() =>
          queryClient.invalidateQueries({ queryKey: todosQuery.queryKey }),
        ),
        tap(() => submission.form.reset()),
        map(() => 'Saved.'),
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
        Fetched through Query/Cache and created through an RxJS server action.
      </p>
      {list$}
      <form on={{ submit: submit$ }}>
        <input
          name="title"
          type="text"
          placeholder="What needs doing?"
          required
        />
        <button type="submit">Add</button>
      </form>
      <p>{status$}</p>
    </section>
  );
};
