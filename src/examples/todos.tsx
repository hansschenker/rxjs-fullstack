import { Subject, catchError, concatMap, exhaustMap, filter, map, of, startWith, tap } from 'rxjs';

import { list, mapMessage, mapModel, type Component, type MessageSink } from '../component';
import { createTodoInput, type CreateTodoInput } from '../domain/todos';
import type { JsxComponent } from '../jsx/runtime';
import { QueryClient } from '../query';
import { createTodo$, todosQuery, type Todo } from '../queries/todos';

export const queryClient = new QueryClient();

interface TodoSubmission {
  readonly form: HTMLFormElement;
  readonly input: CreateTodoInput;
}

export interface TodosModel {
  readonly todos: readonly Todo[];
}

interface SubmitTodoMessage {
  readonly type: 'SubmitTodo';
  readonly event: SubmitEvent;
}

export type TodoMessage = SubmitTodoMessage;

const noMessages: MessageSink<never> = {
  next: () => undefined,
};

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

const isSubmitTodoMessage = (message: TodoMessage): message is SubmitTodoMessage =>
  message.type === 'SubmitTodo';

const toSubmitTodoMessage = (event: SubmitEvent): TodoMessage => ({
  type: 'SubmitTodo',
  event,
});

const TodoItem: Component<Todo, never> = ({ model: todo }) => (
  <li>
    {todo.done ? '✓ ' : '○ '}
    {todo.title}
  </li>
);

const selectTodos = (model: TodosModel): readonly Todo[] => model.todos;
const TodoItems = mapModel(selectTodos)(list(TodoItem));

/**
 * Component algebra: one Todo component is lifted to a list and focused from
 * TodosModel to its todo collection; this component then adds the list's JSX
 * structure without changing the model or message vocabulary.
 */
export const TodoList: Component<TodosModel, never> = ({ model, messages }) => (
  <ul>{TodoItems({ model, messages })}</ul>
);

export const TodoSnapshot: JsxComponent<{ readonly todos: readonly Todo[] }> = ({ todos }) => (
  <section>
    <h2>Todos</h2>
    <p>Prefetched on the server and carried into the browser Query/Cache.</p>
    <TodoList model={{ todos }} messages={noMessages} />
  </section>
);

const TodoFormFields: JsxComponent = () => [
  <input name="title" type="text" placeholder="What needs doing?" required />,
  <button type="submit">Add</button>,
];

/**
 * Primitive form component: the DOM submit package is the local message. The
 * outer Todo component vocabulary is introduced separately with mapMessage.
 */
const SubmitTodoForm: Component<void, SubmitEvent> = ({ messages }) => (
  <form on={{ submit: messages }}>
    <TodoFormFields />
  </form>
);

const TodoForm: Component<void, TodoMessage> = mapMessage(toSubmitTodoMessage)(SubmitTodoForm);

/**
 * Resource/workflow boundary for the sample. The view pieces above are
 * Component<Model, Message> values; this shell creates the RxJS sources and
 * states exactly how their packages move through time.
 */
export const TodoApp: JsxComponent = () => {
  const messages$ = new Subject<TodoMessage>();

  const list$ = queryClient.query$(todosQuery).pipe(
    map((result) => {
      if (result.isLoading) {
        return <p>Loading todos...</p>;
      }

      if (result.isError) {
        return <p>Failed to load todos.</p>;
      }

      return <TodoList model={{ todos: result.data ?? [] }} messages={noMessages} />;
    }),
  );

  // RxJS remains the workflow engine. The Component Algebra only turns the
  // browser event into a typed TodoMessage; operators retain all temporal and
  // concurrency semantics explicitly here.
  const status$ = messages$.pipe(
    filter(isSubmitTodoMessage),
    map((message) => message.event),
    tap(preventFormNavigation),
    exhaustMap((event) => {
      const submission = readTodoSubmission(event);
      if (!submission) {
        return of('Enter a todo.');
      }

      return createTodo$(submission.input).pipe(
        concatMap(() => queryClient.invalidateQueries({ queryKey: todosQuery.queryKey })),
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
      <p>JSX is the view, domain functions provide meaning, and RxJS runs the workflow.</p>
      {list$}
      <TodoForm model={undefined} messages={messages$} />
      <p>{status$}</p>
    </section>
  );
};
