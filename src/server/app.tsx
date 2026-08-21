import { Hono } from 'hono';

import { helloRoute, homeRoute } from '../examples/routes';
import { registerPageRoute } from '../router/route';

export const app = new Hono();

app.get('/health', (context) => context.json({ ok: true }));

registerPageRoute(app, homeRoute);
registerPageRoute(app, helloRoute);

export default app;
