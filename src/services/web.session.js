import session from 'express-session';
import mongoSession from 'connect-mongo';

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

  return sessionMiddleware;

};
