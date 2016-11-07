import _ from 'lodash';
import fsp from 'fs-promise';
import mongoose from 'mongoose';
import async from 'async';
import utils from 'libs/utils';
import objectId from 'libs/objectId';
import errors from 'libs/errors';

export default () => {
  const MatchSchema = new mongoose.Schema({
    status: String,
    u1: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    u2: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    u1Submission: { type: mongoose.Schema.Types.ObjectId, ref: 'Submission' },
    u2Submission: { type: mongoose.Schema.Types.ObjectId, ref: 'Submission' },
    rounds: [{
      _id: mongoose.Schema.Types.ObjectId,
      status: String,
      u1Black: Boolean,
      u2Black: Boolean, // !u1Black
      openingId: String,
      beginJudgeAt: Date,
      endJudgeAt: Date,
      logBlob: mongoose.Schema.Types.ObjectId,  // grid fs
      text: String,
      summary: String,
    }],
  }, {
    timestamps: true,
  });

  // Match Model
  let Match;

  // For both match and round
  MatchSchema.statics.STATUS_PENDING = 'pending';
  MatchSchema.statics.STATUS_RUNNING = 'running';
  MatchSchema.statics.STATUS_SYSTEM_ERROR = 'se';
  MatchSchema.statics.STATUS_U1WIN = 'u1win';
  MatchSchema.statics.STATUS_U2WIN = 'u2win';
  MatchSchema.statics.STATUS_DRAW = 'draw';

  MatchSchema.statics.RELATIVE_STATUS_WIN = 'win';
  MatchSchema.statics.RELATIVE_STATUS_LOSE = 'lose';
  MatchSchema.statics.RELATIVE_STATUS_DRAW = 'draw';

  MatchSchema.statics.JUDGE_EXITCODE_MIN = 33;

  MatchSchema.statics.JUDGE_EXITCODE_STATUS = {
    [MatchSchema.statics.JUDGE_EXITCODE_MIN + 0]: MatchSchema.statics.STATUS_U1WIN,
    [MatchSchema.statics.JUDGE_EXITCODE_MIN + 1]: MatchSchema.statics.STATUS_U2WIN,
    [MatchSchema.statics.JUDGE_EXITCODE_MIN + 2]: MatchSchema.statics.STATUS_DRAW,
    [MatchSchema.statics.JUDGE_EXITCODE_MIN + 3]: MatchSchema.statics.STATUS_SYSTEM_ERROR,
  };

  MatchSchema.statics.STATUS_TEXT = {
    'pending': 'Pending',
    'running': 'Running',
    'se': 'Error',
    'win': 'Win',
    'lose': 'Lose',
    'u1win': 'Challenger Win',
    'u2win': 'Challenger Lose',
    'draw': 'Draw',
  };

  MatchSchema.statics.ROUND_STATUS_TEXT = MatchSchema.statics.STATUS_TEXT;

  MatchSchema.pre('save', function (next) {
    this.__lastIsNew = this.isNew;
    this.__lastModifiedPaths = this.modifiedPaths();
    next();
  });

  MatchSchema.post('save', function () {
    const mdoc = this.toObject();
    Promise.all([
      (async () => {
        if (this.__lastIsNew) {
          await DI.eventBus.emitAsyncWithProfiling('match:created::**', mdoc);
        }
      })(),
      ...this.__lastModifiedPaths.map(async (path) => {
        let m;
        if (path === 'status') {
          await DI.eventBus.emitAsyncWithProfiling('match.status:updated::**', mdoc);
        } else if (m = path.match(/^rounds\.(\d+)$/)) {
          const rdoc = mdoc.rounds[m[1]];
          await DI.eventBus.emitAsyncWithProfiling('match.rounds:updated::**', mdoc, rdoc);
        } else if (m = path.match(/^rounds\.(\d+)\.status$/)) {
          const rdoc = mdoc.rounds[m[1]];
          await DI.eventBus.emitAsyncWithProfiling('match.rounds.status:updated::**', mdoc, rdoc);
        }
      }),
    ]);
  });

  /**
   * Update the match status one by one when round status is updated
   */
  const updateStatusQueue = async.queue((mdocid, callback) => {
    Match.updateMatchStatusAsync(mdocid)
      .then(callback)
      .catch(() => callback());
  }, 1);

  DI.eventBus.on('match.rounds.status:updated', mdoc => {
    updateStatusQueue.push(mdoc._id);
  });

  /**
   * Determine whether a match status is one of running status (pending / running)
   *
   * @param  {String}  matchStatus
   * @return {Boolean}
   */
  MatchSchema.statics.isRunningStatus = function (matchStatus) {
    if (matchStatus === Match.STATUS_PENDING) {
      return true;
    }
    if (matchStatus === Match.STATUS_RUNNING) {
      return true;
    }
    return false;
  };

  /**
   * Get the match object by userId
   *
   * @return {Match} Mongoose match object
   */
  MatchSchema.statics.getMatchObjectByIdAsync = async function (id, projection = {}, throwWhenNotFound = true) {
    if (!objectId.isValid(id)) {
      if (throwWhenNotFound) {
        throw new errors.UserError('Match not found');
      } else {
        return null;
      }
    }
    const s = await Match.findOne({ _id: id }, projection).exec();
    if (s === null && throwWhenNotFound) {
      throw new errors.UserError('Match not found');
    }
    return s;
  };

  /**
   * Get round status from fun-judge exit code
   * @param  {Number} exitCode
   * @return {String}
   */
  MatchSchema.statics.getStatusFromJudgeExitCode = function (exitCode) {
    if (Match.JUDGE_EXITCODE_STATUS[exitCode] !== undefined) {
      return Match.JUDGE_EXITCODE_STATUS[exitCode];
    }
    return Match.STATUS_SYSTEM_ERROR;
  };

  /**
   * Get opening data from opening id
   * TODO: optimize
   * @param  {String} openingId
   * @return {String}
   */
  MatchSchema.statics.getOpeningFromIdAsync = async function (openingId) {
    const filePath = `./openings/${openingId}.json`;
    const content = await fsp.readFile(filePath);
    return content.toString();
  };

  /**
   * Generate initial round docs for a match
   * @return {[Match.Round]}
   */
  function generateRoundDocs() {
    const rounds = [];
    for (const openingId of DI.config.match.openings) {
      for (const u1Black of [true, false]) {
        rounds.push({
          _id: mongoose.Types.ObjectId(),
          status: Match.STATUS_PENDING,
          u1Black,
          u2Black: !u1Black,
          openingId: String(openingId),
        });
      }
    }
    return rounds;
  }

  /**
   * Add all matches for a new submission. If the submission have related matches
   * previously, they will be removed.
   *
   * @param {Submission} s1
   * @param {User} u1
   * @param {[{_id: User, sdocid: Submission}]} s2u2docs
   */
  MatchSchema.statics.addMatchesForSubmissionAsync = async function (s1, u1, s2u2docs) {
    await Match.remove({ u1Submission: s1 });
    if (s2u2docs.length === 0) {
      return [];
    }

    const endProfile = utils.profile('Match.addMatchesForSubmissionAsync');

    const mdocs = [];
    await Promise.all(s2u2docs.map(async s2u2doc => {
      const mdoc = new Match({
        status: Match.STATUS_PENDING,
        u1,
        u2: s2u2doc._id,
        u1Submission: s1,
        u2Submission: s2u2doc.sdocid,
        rounds: generateRoundDocs(),
      });
      await mdoc.save();
      // push each round of each match into the queue
      await Promise.all(mdoc.rounds.map(async round => await DI.mq.publish('judge', {
        mdocid: String(mdoc._id),
        s1docid: String(mdoc.u1Submission),
        s2docid: String(mdoc.u2Submission),
        rid: round._id,
        u1field: round.u1Black ? 'black' : 'white',
        opening: await Match.getOpeningFromIdAsync(round.openingId),
        rules: DI.config.match.rules,
      })));
      mdocs.push(mdoc);
    }));

    endProfile();

    return mdocs;
  };

  /**
   * Translate MatchStatus into RelativeStatus
   *
   * @param  {String}  status
   * @param  {Boolean} isU1
   * @return {String}
   */
  MatchSchema.statics.getRelativeStatus = function (status, isU1 = true) {
    if (status !== Match.STATUS_U1WIN && status !== Match.STATUS_U2WIN) {
      return status;
    }
    if (isU1) {
      if (status === Match.STATUS_U1WIN) {
        return Match.RELATIVE_STATUS_WIN;
      } else {
        return Match.RELATIVE_STATUS_LOSE;
      }
    } else {
      if (status === Match.STATUS_U1WIN) {
        return Match.RELATIVE_STATUS_LOSE;
      } else {
        return Match.RELATIVE_STATUS_WIN;
      }
    }
  };

  /**
   * Update match status according to round status
   */
  MatchSchema.methods.updateStatus = function () {
    const statusStat = {
      [Match.STATUS_PENDING]: 0,
      [Match.STATUS_RUNNING]: 0,
      [Match.STATUS_SYSTEM_ERROR]: 0,
      [Match.STATUS_U1WIN]: 0,
      [Match.STATUS_U2WIN]: 0,
      [Match.STATUS_DRAW]: 0,
    };
    this.rounds.forEach(rdoc => statusStat[rdoc.status]++);
    if (statusStat[Match.STATUS_PENDING] === this.rounds.length) {
      // all pending
      this.status = Match.STATUS_PENDING;
      return;
    }
    if (statusStat[Match.STATUS_SYSTEM_ERROR] > 0) {
      // some system error
      this.status = Match.STATUS_SYSTEM_ERROR;
      return;
    }
    if (statusStat[Match.STATUS_RUNNING] > 0 || statusStat[Match.STATUS_PENDING] > 0) {
      // some pending, or some running
      this.status = Match.STATUS_RUNNING;
      return;
    }
    if (statusStat[Match.STATUS_U1WIN] > statusStat[Match.STATUS_U2WIN]) {
      this.status = Match.STATUS_U1WIN;
    } else if (statusStat[Match.STATUS_U1WIN] < statusStat[Match.STATUS_U2WIN]) {
      this.status = Match.STATUS_U2WIN;
    } else {
      this.status = Match.STATUS_DRAW;
    }
  };

  MatchSchema.statics.updateMatchStatusAsync = async function (mdocid) {
    const mdoc = await Match.getMatchObjectByIdAsync(mdocid);
    mdoc.updateStatus();
    await mdoc.save();
  };

  /**
   * Mark a pending round as running
   *
   * @param  {MongoId} mdocid Match Id
   * @param  {MongoId} rid Round Id
   * @return {Match}
   */
  MatchSchema.statics.judgeStartRoundAsync = async function (mdocid, rid) {
    const mdoc = await Match.getMatchObjectByIdAsync(mdocid);
    const round = mdoc.rounds.find(rdoc => rdoc._id.equals(rid));
    if (round !== undefined) {
      round.status = Match.STATUS_RUNNING;
      round.beginJudgeAt = new Date();
      await mdoc.save();
    }
    return mdoc;
  };

  /**
   * Mark a round as completed (u1win, u2win or draw) or error.
   *
   * @param  {MongoId} mdocid Match Id
   * @param  {MongoId} rid Round Id
   * @param  {String} status
   * @param  {Object} extra Extra fields to be added to the round
   * @return {Match}
   */
  MatchSchema.statics.judgeCompleteRoundAsync = async function (mdocid, rid, status, extra = {}) {
    if (
      status !== Match.STATUS_U1WIN
      && status !== Match.STATUS_U2WIN
      && status !== Match.STATUS_DRAW
      && status !== Match.STATUS_SYSTEM_ERROR
    ) {
      throw new Error(`judgeCompleteRoundAsync: status ${status} is invalid`);
    }
    const mdoc = await Match.getMatchObjectByIdAsync(mdocid);
    const round = mdoc.rounds.find(rdoc => rdoc._id.equals(rid));
    if (round !== undefined) {
      round.status = status;
      round.endJudgeAt = new Date();
      if (!round.beginJudgeAt) {
        round.beginJudgeAt = new Date();
      }
      _.assign(round, extra);
      await mdoc.save();
    }
    return mdoc;
  };

  /**
   * Get all related matches for a submission
   * @param  {MongoId} sid
   * @return {[Cursor]}
   */
  MatchSchema.statics.getMatchesForSubmissionCursor = function (sid) {
    return Match
      .find({
        $or: [
          { u1Submission: sid },
          { u2Submission: sid },
        ],
      })
      .sort({ _id: -1 });
  };

  /**
   * Update status of all matches
   */
  MatchSchema.statics.refreshAllMatchesAsync = async function () {
    let ret = {
      updated: 0,
      all: 0,
    };
    const cursor = Match.find().sort({ _id: 1 }).cursor();
    for (let mdoc = await cursor.next(); mdoc !== null; mdoc = await cursor.next()) {
      ret.all++;
      mdoc.updateStatus();
      if (mdoc.isModified('status')) {
        ret.updated++;
        await mdoc.save();
      }
    }
    return ret;
  };

  /**
   * Get pairwise matches for the given submissions
   */
  MatchSchema.statics.getPairwiseMatchesAsync = async function (sids) {
    return await Match
      .find({
        u1Submission: { $in: sids },
        u2Submission: { $in: sids },
        status: { $in: [Match.STATUS_U1WIN, Match.STATUS_U2WIN, Match.STATUS_DRAW] },
      })
      .sort({ _id: -1 })
      .exec();
  };

  MatchSchema.index({ u1Submission: 1, u2Submission: -1, status: 1, _id: -1 }, { unique: true });
  MatchSchema.index({ u1Submission: 1, _id: -1 });
  MatchSchema.index({ u2Submission: 1, _id: -1 });

  Match = mongoose.model('Match', MatchSchema);
  return Match;

};
