import _ from 'lodash';
import fsp from 'fs-promise';
import mongoose from 'mongoose';
import utils from 'libs/utils';
import objectId from 'libs/objectId';
import errors from 'libs/errors';
import EloRank from 'elo-rank';

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
  RatingSchema.statics.STATUS_WIN = 'win';
  RatingSchema.statics.STATUS_LOSE = 'lose';
  RatingSchema.statics.STATUS_DRAW = 'draw';
  RatingSchema.statics.STATUS_ERROR = 'error';
  RatingSchema.statics.STATUS_INIT = 'init';

  RatingSchema.statics.getRatingObjectByIdAsync = async function(
    id, projection = {}, throwWhenNotFound = true) {
    if (!objectId.isValid(id)) {
      if (throwWhenNotFound) {
        throw new Error(`Rating ${id} not found`);
      } else {
        return null;
      }
    }
    const s = await Rating.findOne({_id: id}, projection).exec();
    if (s === null && throwWhenNotFound) {
      throw new Error(`Rating ${id} not found`);
    }
    return s;
  };

  RatingSchema.statics.getUserRatingsAsync = async function(user) {
    return Rating.find({user}).sort({_id: 1});
  };

  RatingSchema.statics.initUserRatingAsync = async function(user) {
    const data = await Rating.getUserRatingsAsync(user);
    if (data.length > 0) {
      throw new Error('not init');
    }
    const rating = new this({
      status: Rating.STATUS_INIT,
      user,
      before: 1500,
      after: 1500,
      change: 0,
    });
    await rating.save();
    await DI.models.User.updateRatingAsync(user, rating);
    return rating;
  };

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

  RatingSchema.statics.createRatingAsync = async function(match, user) {
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

  RatingSchema.statics.getTitleData = function(score) {
    let data = null;
    _.forEach(DI.config.rating.titles, title => {
      if (score >= title.range[0] && score < title.range[1]) {
        data = title;
      }
    });
    if (!data) {
      return DI.config.rating.unrated;
    }
    return data;
  };

  RatingSchema.methods.getEloRank = function() {
    return new EloRank(Rating.getTitleData(this.before).factor);
  };

  RatingSchema.methods.setWinAsync = async function(opponentScore) {
    const elo = this.getEloRank();
    const expect = elo.getExpected(this.before, opponentScore);
    this.after = elo.updateRating(expect, 1, this.before);
    this.change = this.after - this.before;
    this.status = Rating.STATUS_WIN;
    await this.save();
  };

  RatingSchema.methods.setLoseAsync = async function(opponentScore) {
    const elo = this.getEloRank();
    const expect = elo.getExpected(this.before, opponentScore);
    this.after = elo.updateRating(expect, 0, this.before);
    this.change = this.after - this.before;
    this.status = Rating.STATUS_LOSE;
    await this.save();
  };

  RatingSchema.methods.setDrawAsync = async function() {
    this.after = this.before;
    this.change = 0;
    this.status = Rating.STATUS_DRAW;
    await this.save();
  };

  RatingSchema.methods.setErrorAsync = async function() {
    this.after = this.before;
    this.change = 0;
    this.status = Rating.STATUS_ERROR;
    await this.save();
  };

  //RatingSchema.index({ userName_std: 1 }, { unique: true });

  Rating = mongoose.model('Rating', RatingSchema);
  return Rating;
}