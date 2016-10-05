import nunjucks from 'nunjucks';
import filesize from 'filesize';
import moment from 'moment';
import _ from 'lodash';
import utils from 'libs/utils';

export default (app) => {

  app.set('views', `${__projectRoot}/ui/templates`);
  app.set('view engine', 'html');

  const njenv = nunjucks.configure(`${__projectRoot}/ui/templates`, {
    autoescape: true,
    express: app,
    watch: true,
    throwOnUndefined: true,
  });

  Date.prototype.toJSON = function () {
    return this.getTime();
  };

  // Notice that this would not escape chars like < and >
  njenv.addFilter('json', str => JSON.stringify(str));

  njenv.addFilter('filesize', bytes => filesize(bytes));
  njenv.addFilter('duration', ms => moment.duration(ms).humanize());
  njenv.addFilter('datetime', date => {
    return nunjucks.runtime.markSafe(`
      <span
        class="time"
        data-timestamp="${~~(date.getTime() / 1000)}"
      >
        ${moment(date).format('YYYY-MM-DD HH:mm:ss')}
      </span>
    `);
  });

  njenv.addGlobal('static_url', utils.static_url);
  njenv.addGlobal('url', utils.url);
  njenv.addGlobal('DI', path => _.get(DI, path));

  // Expose necessary object
  app.use((req, res, next) => {

    const _render = res.render;
    res.render = (pageName, parameters = {}) => {
      _render.call(res, pageName, {
        page_name: pageName,
        ...parameters,
      });
    };

    res.locals.req = req;
    res.locals.config = DI.config;
    res.locals.ui_context = res.locals.ui_context || {};
    res.locals.ui_context.cdn_prefix = DI.config.cdn_prefix;

    next();
  });

  return njenv;

};
