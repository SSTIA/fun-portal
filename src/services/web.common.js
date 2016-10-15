import cookieParser from 'cookie-parser';
import methodOverride from 'method-override';
import bodyParser from 'body-parser';
import compress from 'compression';

export default (app) => {

  app.use(bodyParser.json({
    limit: '2mb',
  }));
  app.use(bodyParser.urlencoded({
    limit: '2mb',
    extended: false,
  }));
  app.use(cookieParser());
  app.use(methodOverride());

  app.use(compress());

};
