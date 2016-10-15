import session from 'express-session';
import mongoSession from 'connect-mongo';
import credential from 'libs/credential';

export default (app, dbConnection) => {

  const MongoStore = mongoSession(session);
  const sessionMiddleware = session({
    secret: DI.config.secret,
    resave: false,
    saveUninitialized: false,
    store: new MongoStore({
      mongooseConnection: dbConnection,
    }),
  });

  app.use(sessionMiddleware);

  app.use((req, res, next) => {
    credential.populateCredentialFromSession(req).then(next);
  });

  return sessionMiddleware;

};
