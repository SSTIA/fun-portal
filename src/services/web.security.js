import csurf from 'csurf';
import helmet from 'helmet';

export default (app) => {

  app.use(helmet.contentSecurityPolicy({
    directives: {
      connectSrc: ['\'self\'', `ws://${DI.config.host}`],
      defaultSrc: ['\'self\''],
      scriptSrc: ['\'self\'', '\'unsafe-inline\'', '\'unsafe-eval\''],
      styleSrc: ['\'self\'', '\'unsafe-inline\''],
      imgSrc: ['\'self\'', 'data:', 'https://avatars0.githubusercontent.com'],
      reportUri: `${DI.config.cspReportUrl}`,
    },
  }));
  app.use(helmet.xssFilter());
  app.use(helmet.noSniff());
  app.use(helmet.frameguard());
  app.use(helmet.hidePoweredBy());

  const csrf = csurf();

  // Check csrf tokens
  app.use((req, res, next) => {
    if (req.url.indexOf('/api/') !== -1) {
      next();
      return;
    }
    return csrf(req, res, next);
  });

};
