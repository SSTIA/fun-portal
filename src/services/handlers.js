import glob from 'glob';
import Router from 'express-promise-router';
import escapeHtml from 'escape-html';
import errors from 'libs/errors';

export default (app, logger) => {

  const router = Router();
  app.use(router);

  const handlers = glob
    .sync(`${__codeRoot}/handlers/*.js`)
    .map(handler => {
      const hi = new (require(handler).default)(app);
      hi.register(router);
    });

  // Fallback: Generate 404
  app.use((req, res, next) => {
    const err = new errors.UserError('该页面不存在');
    err.status = 404;
    next(err);
  });

  // Handle BADCSRFTOKEN
  app.use((err, req, res, next) => {
    if (err.code !== 'EBADCSRFTOKEN') {
      return next(err);
    }
    err = new errors.UserError('CSRF Token 验证失败');
    err.status = 403;
    next(err);
  });

  // Handle Non-User Errors
  app.use((err, req, res, next) => {
    if (err.status === undefined) {
      err.status = 500;
    }
    if (err.status === 500) {
      err.message = `服务端错误：${err.message}`;
    }
    next(err);
  });

  // Handle Error outputs
  app.use((err, req, res) => {
    if (err.status === 500) {
      logger.error(err);
    }
    res.status(err.status);
    const errObject = {
      err: true,
      status: err.status,
      msg: err.message,
      msgHtml: err.messageHtml || escapeHtml(err.message),
      name: err.name,
    };
    if (req.xhr) {
      res.json(errObject);
    } else {
      res.render('error', { error: errObject });
    }
  });

  return handlers;

};
