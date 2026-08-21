import { createRoute } from 'rxjs-router';

export const loadRootData = () => ({
  appName: 'RxJS Fullstack',
});

export const rootBaseRoute = createRoute({
  id: 'root',
  path: '/',
  loader: loadRootData,
});

export type RootRoute = typeof rootBaseRoute;
