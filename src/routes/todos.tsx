import { createChildRoute } from 'rxjs-router';

import { TodoApp } from '../examples/todos';
import { Fragment, jsx } from '../jsx/runtime';
import { rootBaseRoute } from './root';
import type { PageData } from './types';

const TodosView = () => {
  if (typeof document === 'undefined') {
    return <p>Loading todos...</p>;
  }

  return <TodoApp />;
};

export const todosRoute = createChildRoute<typeof rootBaseRoute>()({
  id: 'todos',
  path: 'todos',
  loader: ({ parentData }): PageData => ({
    title: `${parentData.appName} Todos`,
    view: (
      <main>
        <h1>{parentData.appName} Todos</h1>
        <p>Server data managed by rxjs-query.</p>
        <TodosView />
      </main>
    ),
  }),
});
