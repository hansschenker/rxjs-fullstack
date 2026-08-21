import { Counter } from './counter';
import { Fragment, jsx } from '../jsx/runtime';
import { mount } from '../render/dom';

const root = document.querySelector('#app');

if (!(root instanceof Element)) {
  throw new Error('Expected #app mount element.');
}

const lifetime = mount(<Counter />, root);
window.addEventListener('pagehide', () => lifetime.unsubscribe(), { once: true });
