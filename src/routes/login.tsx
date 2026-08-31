import { createChildRoute } from 'rxjs-router';

import { LoginPage } from '../examples/auth';
import { rootBaseRoute } from './root';
import type { PageData } from './types';

const messageForSearch = (search: unknown): string | undefined => {
  if (typeof search !== 'object' || search === null) {
    return undefined;
  }
  if (Reflect.get(search, 'registered') === '1') {
    return 'Account created. You can now sign in.';
  }
  if (Reflect.get(search, 'loggedOut') === '1') {
    return 'You have been signed out.';
  }
  if (Reflect.get(search, 'error') === 'invalid') {
    return 'Invalid email or password.';
  }
  return undefined;
};

export const loginRoute = createChildRoute<typeof rootBaseRoute>()({
  id: 'login',
  path: 'login',
  loader: ({ parentData, search }): PageData => ({
    title: `${parentData.appName} Login`,
    view: <LoginPage message={messageForSearch(search)} />,
  }),
});

export default loginRoute;
