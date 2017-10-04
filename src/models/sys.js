import _ from 'lodash';
import mongoose from 'mongoose';

export default () => {
  const SysSchema = new mongoose.Schema({
    key: String,
    value: mongoose.Schema.Types.Mixed,
  }, {
    timestamps: true,
  });

  // Sys Model
  let Sys;

  SysSchema.statics.getAllAsync = async function () {
    const sdocs = await Sys.find({});
    return _(sdocs).keyBy('key').mapValues('value').value();
  };

  SysSchema.statics.getAsync = async function (key, defValue = null) {
    const ret = await Sys.findOne({ key }).exec();
    if (ret === null) {
      return defValue;
    } else {
      return ret.value;
    }
  };

  SysSchema.statics.setAsync = async function (key, value) {
    await Sys.update({ key }, { $set: { value } }, { upsert: true }).exec();
  };

  SysSchema.index({ key: 1 }, { unique: true });

  Sys = mongoose.model('Sys', SysSchema);
  return Sys;

};
