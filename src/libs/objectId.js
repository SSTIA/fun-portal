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

  fromDatetime: (datetime) => {
    const id = Math.floor(datetime.getTime() / 1000).toString(16) + '0000000000000000';
    return objectId.create(id);
  },

};

export default objectId;
