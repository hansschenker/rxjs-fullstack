import type { CreateTodoInput, Todo } from '../domain/todos';

let nextTodoId = 3;
const todos: Todo[] = [
  { id: 1, title: 'Port TanStack Query to RxJS', done: true },
  { id: 2, title: 'Integrate rxjs-query into rxjs-fullstack', done: false },
];

export const listTodos = (): readonly Todo[] => todos;

export const addTodo = ({ title }: CreateTodoInput): Todo => {
  const todo: Todo = { id: nextTodoId++, title, done: false };
  todos.push(todo);
  return todo;
};
