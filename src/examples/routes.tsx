import { of } from 'rxjs';

import { HomePage, type HomeModel } from './home';
import { Fragment, jsx } from '../jsx/runtime';
import { definePageRoute } from '../router/route';

export const homeRoute = definePageRoute('/')<HomeModel>({
  load: () =>
    of({
      title: 'RxJS Fullstack',
      milestone: 'M05 — strongly typed routing',
    }),
  view: HomePage,
  title: 'RxJS Fullstack',
});

export const helloRoute = definePageRoute('/hello/:name')({
  load: ({ params }) =>
    of({
      name: params.name,
    }),
  view: ({ name }) => (
    <main>
      <h1>Hello {name}</h1>
      <p>The route parameter was inferred from the path literal.</p>
    </main>
  ),
  title: ({ name }) => `Hello ${name}`,
});
