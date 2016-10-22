import mongoose from 'mongoose';

const checkForHexRegExp = new RegExp('^[0-9a-fA-F]{24}$');

const objectId = {

  isValid: (id) => {
    if (id instanceof mongoose.Types.ObjectId) {
      return true;
    }
    id = String(id);
    return checkForHexRegExp.test(id);
  },

  create: (id) => {
    if (id instanceof mongoose.Types.ObjectId) {
      return id;
    } else {
      return mongoose.Types.ObjectId(id);
    }
  },

  getFromIdOrDoc: (idOrDoc, field = '_id') => {
    if (idOrDoc instanceof mongoose.Types.ObjectId) {
      return idOrDoc;
    } else {
      return idOrDoc[field];
    }
  },

  fromTimestamp: (timestamp) => {
    return Math.floor(timestamp).toString(16) + '0000000000000000';
  },

};

export default objectId;
