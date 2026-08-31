import { createChildRoute } from 'rxjs-router';

import { RegisterPage } from '../examples/auth';
import { rootBaseRoute } from './root';
import type { PageData } from './types';

const messageForSearch = (search: unknown): string | undefined => {
  if (typeof search !== 'object' || search === null) {
    return undefined;
  }
  const error = Reflect.get(search, 'error');
  if (error === 'exists') {
    return 'That email is already registered.';
  }
  if (error === 'invalid') {
    return 'Use a valid email and a password of 12–128 characters.';
  }
  return undefined;
};

export const registerRoute = createChildRoute<typeof rootBaseRoute>()({
  id: 'register',
  path: 'register',
  loader: ({ parentData, search }): PageData => ({
    title: `${parentData.appName} Register`,
    view: <RegisterPage message={messageForSearch(search)} />,
  }),
});

export default registerRoute;
