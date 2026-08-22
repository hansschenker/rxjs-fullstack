import { hydrateQueryClientFromDocument } from '../query';
import { mount } from '../render/dom';
import { queryClient } from './todos';
import { createTodosShell } from './todos-shell';

const root = document.querySelector('#app');

if (!(root instanceof Element)) {
  throw new Error('Expected #app mount element.');
}

hydrateQueryClientFromDocument(queryClient, document);

const shell = createTodosShell();
const lifetime = mount(shell.view, root);
lifetime.add(shell.navigation$.subscribe());
window.addEventListener('pagehide', () => lifetime.unsubscribe(), { once: true });
