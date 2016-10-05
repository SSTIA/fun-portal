import helmet from 'helmet';
import csrf from 'csurf';
import _ from 'lodash';

export default (app) => {

  app.use(helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      reportUri: `${DI.config.csp_report_url}`,
    },
  }));
  app.use(helmet.xssFilter());
  app.use(helmet.noSniff());
  app.use(helmet.frameguard());
  app.use(helmet.hidePoweredBy());

  // Expose CSRF token to view
  app.use(csrf());
  app.use((req, res, next) => {
    res.locals.ui_context = res.locals.ui_context || {};
    if (req.csrfToken) {
      res.locals.ui_context.csrf_token = req.csrfToken();
    } else {
      res.locals.ui_context.csrf_token = '__TOKEN__';
    }
    next();
  });

};
