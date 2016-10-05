import express from 'express';

import http from 'http';

export default (logger) => {

  const app = express();
  app.set('trust proxy', 'loopback');

  app.server = http.createServer(app);
  app.server.listen(DI.config.port, () => {
    logger.info(`WebServer: Listening at ${DI.config.port}`);
  });

  return app;

};
