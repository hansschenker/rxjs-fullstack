import { of } from 'rxjs';

import { Fragment, jsx } from '../jsx/runtime';
import { mount } from '../render/dom';
import { TodoApp } from './todos';

const root = document.querySelector('#app');

if (!(root instanceof Element)) {
  throw new Error('Expected #app mount element.');
}

const lifetime = mount(of(<TodoApp />), root);
window.addEventListener('pagehide', () => lifetime.unsubscribe(), { once: true });
