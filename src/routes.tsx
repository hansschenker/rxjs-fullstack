import { createRoute } from 'rxjs-router';

import { counterRoute } from './routes/counter';
import { homeRoute } from './routes/home';
import { loadRootData } from './routes/root';
import { todosRoute } from './routes/todos';

export type { PageData } from './routes/types';

export const routes = [
  createRoute({
    id: 'root',
    path: '/',
    loader: loadRootData,
    children: [homeRoute, counterRoute, todosRoute],
  }),
] as const;

export type AppRoutes = typeof routes;
