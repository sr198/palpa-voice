import { buildApp } from './app.js';
import { config } from './config.js';

const app = await buildApp();

app.listen({ host: config.apiHost, port: config.apiPort }).then(() => {
  console.log(`Palpa API listening on http://${config.apiHost}:${config.apiPort}`);
});
