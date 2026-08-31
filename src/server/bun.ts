// Compatibility entry point retained from M04. The M11 composition root now
// injects the persistent database repository before Bun hosts the application.
export { default } from '../runtime/bun-server';
