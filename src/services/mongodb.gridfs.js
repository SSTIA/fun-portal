import mongoose from 'mongoose';
import Grid from 'gridfs-stream';

export default async (dbConnection) => {

  const gfs = Grid(dbConnection.db, mongoose.mongo);

  return {
    putBlobAsync(rstream, options) {
      return new Promise((resolve, reject) => {
        const wstream = gfs.createWriteStream(options);
        wstream.on('close', file => resolve(file));
        wstream.on('error', err => reject(err));
        rstream.pipe(wstream);
      });
    },
    getBlobAsync(id, wstream) {
      return new Promise((resolve, reject) => {
        const rstream = gfs.createReadStream({ _id: id });
        rstream.on('close', () => resolve());
        rstream.on('error', err => reject(err));
        rstream.pipe(wstream);
      });
    },
    existsAsync(id) {
      return new Promise((resolve, reject) => {
        gfs.exist({ _id: id }, (err, found) => {
          if (err) {
            return reject(err);
          }
          resolve(found);
        });
      });
    },
  };

};
