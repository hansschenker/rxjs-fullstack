import { of } from 'rxjs';

import { Fragment, jsx } from '../jsx/runtime';
import { hydrateQueryClientFromDocument } from '../query';
import { mount } from '../render/dom';
import { TodoApp, queryClient } from './todos';

const root = document.querySelector('#app');

if (!(root instanceof Element)) {
  throw new Error('Expected #app mount element.');
}

hydrateQueryClientFromDocument(queryClient, document);

const lifetime = mount(of(<TodoApp />), root);
window.addEventListener('pagehide', () => lifetime.unsubscribe(), { once: true });
