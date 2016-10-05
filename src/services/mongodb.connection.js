import mongoose from 'mongoose';

export default async (logger) => {

  const db = await new Promise((resolve, reject) => {
    logger.debug(`MongoDB: Connection Url = ${DI.config.db}`);
    mongoose.connect(DI.config.db);
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
