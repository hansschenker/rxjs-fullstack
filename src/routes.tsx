import { routes } from './routes.generated';

export { generatedRouteFiles, routes } from './routes.generated';
export { Outlet, RouterOutlet, createRouterOutletView$ } from './router-view';
export type {
  ActivatedRouteNode,
  ActivatedRouteTree,
  PageData,
  RouteComponentLifecycle,
  RouteComponentOutput,
  RouteViewContext,
} from './router-view';
export {
  createActivatedRouteTree,
  createRouteComponentLifecycle,
  createRouteViewContext,
} from './router-view';

export type AppRoutes = typeof routes;
