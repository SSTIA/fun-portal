import mongoose from 'mongoose';
import bluebird from 'bluebird';

export default async (logger) => {

  mongoose.Promise = bluebird;

  const db = await new Promise((resolve, reject) => {
    logger.debug(`MongoDB: Connection Url = ${DI.config.db}`);
    mongoose.connect(DI.config.db, {useMongoClient: true});
    const db = mongoose.connection;
    db.on('error', () => {
      reject(new Error(`unable to connect to database at ${DI.config.db}`));
    });
    db.once('open', () => {
      logger.info('MongoDB: Connected');
      resolve(db);
    });
  });

  return db;

};

export function shutdown() {
  mongoose.connection.close();
}
