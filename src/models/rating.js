import _ from 'lodash';
import fsp from 'fs-promise';
import mongoose from 'mongoose';
import utils from 'libs/utils';
import objectId from 'libs/objectId';
import errors from 'libs/errors';

export default function() {
  const RatingSchema = new mongoose.Schema({
    status: String,
    user: {type: mongoose.Schema.Types.ObjectId, ref: 'User'},
    match: {type: mongoose.Schema.Types.ObjectId, ref: 'Match'},
    before: Number,
    after: Number,
    change: Number,
  }, {
    timestamps: true,
  });

  // Rating model
  let Rating;

  RatingSchema.statics.STATUS_PENDING = 'pending';
  RatingSchema.statics.STATUS_FINISH = 'finish';

  /**
   * Find whether a user is busy by his pending state
   * @param user
   * @returns bool
   */
  RatingSchema.statics.isUserBusyAsync = async function(user) {
    const rating = await Rating.findOne({
      user,
      status: Rating.STATUS_PENDING,
    });
    return rating !== null;
  };

  RatingSchema.statics.initRatingAsync = async function(match, user) {
    const rating = new this({
      status: Rating.STATUS_PENDING,
      user,
      match,
      before: user.rating.score,
      after: -1,
      change: 0,
    });
    await rating.save();
    return rating;
  };

  //RatingSchema.index({ userName_std: 1 }, { unique: true });

  Rating = mongoose.model('Rating', RatingSchema);
  return Rating;
}