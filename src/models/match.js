import _ from 'lodash';
import fsp from 'fs-promise';
import mongoose from 'mongoose';
import utils from 'libs/utils';
import objectId from 'libs/objectId';
import errors from 'libs/errors';

export default function() {
  const MatchSchema = new mongoose.Schema({
    status: String,
    u1: {type: mongoose.Schema.Types.ObjectId, ref: 'User'},
    u2: {type: mongoose.Schema.Types.ObjectId, ref: 'User'},
    u1Submission: {type: mongoose.Schema.Types.ObjectId, ref: 'Submission'},
    u2Submission: {type: mongoose.Schema.Types.ObjectId, ref: 'Submission'},
    u1Rating: {type: mongoose.Schema.Types.ObjectId, ref: 'Rating'},
    u2Rating: {type: mongoose.Schema.Types.ObjectId, ref: 'Rating'},
    rounds: [
      {
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
        usedTime: Number,   // extracted from summary by controller
      }],
  }, {
    timestamps: true,
    toObject: {virtuals: true},
    toJSON: {virtuals: true},
  });

  MatchSchema.virtual('usedTime').get(function() {
    return _.sumBy(this.rounds, 'usedTime');
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
    [MatchSchema.statics.JUDGE_EXITCODE_MIN +
    0]: MatchSchema.statics.STATUS_U1WIN,
    [MatchSchema.statics.JUDGE_EXITCODE_MIN +
    1]: MatchSchema.statics.STATUS_U2WIN,
    [MatchSchema.statics.JUDGE_EXITCODE_MIN +
    2]: MatchSchema.statics.STATUS_DRAW,
    [MatchSchema.statics.JUDGE_EXITCODE_MIN +
    3]: MatchSchema.statics.STATUS_SYSTEM_ERROR,
  };

  MatchSchema.statics.STATUS_TEXT = {
    'pending': 'Pending',
    'running': 'Running',
    'se': 'System Error',
    'win': 'Win',
    'lose': 'Lose',
    'u1win': 'Challenger Win',
    'u2win': 'Challenger Lose',
    'draw': 'Draw',
  };

  MatchSchema.statics.ROUND_STATUS_TEXT = MatchSchema.statics.STATUS_TEXT;

  MatchSchema.pre('save', function(next) {
    this.__lastIsNew = this.isNew;
    this.__lastModifiedPaths = this.modifiedPaths();
    next();
  });

  MatchSchema.post('save', function() {
    const mdoc = this.toObject();
    Promise.all([
      (async () => {
        if (this.__lastIsNew) {
          await DI.eventBus.emitAsyncWithProfiling('match:created::**',
            mdoc);
        }
      })(),
      ...this.__lastModifiedPaths.map(async (path) => {
        let m;
        if (path === 'status') {
          await DI.eventBus.emitAsyncWithProfiling('match.status:updated::**',
            mdoc);
        } else if (m = path.match(/^rounds\.(\d+)$/)) {
          const rdoc = mdoc.rounds[m[1]];
          await DI.eventBus.emitAsyncWithProfiling('match.rounds:updated::**',
            mdoc, rdoc);
        } else if (m = path.match(/^rounds\.(\d+)\.status$/)) {
          const rdoc = mdoc.rounds[m[1]];
          await DI.eventBus.emitAsyncWithProfiling(
            'match.rounds.status:updated::**', mdoc, rdoc);
        }
      })]);
  });

  /**
   * Update the match status one by one when round status is updated
   */
  const updateStatusQueue = new utils.DedupWorkerQueue({
    delay: 15,
    asyncWorkerFunc: mdocid => {
      return Match.updateMatchStatusAsync(mdocid);
    },
  });

  DI.eventBus.on('match.rounds.status:updated', mdoc => {
    updateStatusQueue.push(String(mdoc._id));
  });

  /**
   * Determine whether a match status is one of effective status
   * u1win, u2win, draw
   *
   * @param  {String}  matchStatus
   * @return {Boolean}
   */
  MatchSchema.statics.isEffectiveStatus = function(matchStatus) {
    return matchStatus === Match.STATUS_U1WIN ||
      matchStatus === Match.STATUS_U2WIN ||
      matchStatus === Match.STATUS_DRAW;
  };

  /**
   * Determine whether a match status is one of finish status
   * u1win, u2win, draw, error
   * @param matchStatus
   * @returns {boolean}
   */
  MatchSchema.statics.isFinishStatus = function(matchStatus) {
    return matchStatus === Match.STATUS_U1WIN ||
      matchStatus === Match.STATUS_U2WIN ||
      matchStatus === Match.STATUS_DRAW ||
      matchStatus === Match.STATUS_SYSTEM_ERROR;
  };

  /**
   * Get the match object by match id
   *
   * @return {Match} Mongoose match object
   */
  MatchSchema.statics.getMatchObjectByIdAsync = async function(
    id, projection = {}, throwWhenNotFound = true) {
    if (!objectId.isValid(id)) {
      if (throwWhenNotFound) {
        throw new errors.UserError('Match not found');
      } else {
        return null;
      }
    }
    const s = await Match.findOne({_id: id}, projection).exec();
    if (s === null && throwWhenNotFound) {
      throw new errors.UserError('Match not found');
    }
    return s;
  };

  /**
   * Get the round and match object by match id and round id.
   *
   * @return {[Match, Round]}
   */
  MatchSchema.statics.getRoundObjectByIdAsync = async function(mdocid, rdocid) {
    const mdoc = await Match.getMatchObjectByIdAsync(mdocid);
    const rdoc = mdoc.rounds.find(rdoc => rdoc._id.equals(rdocid));
    if (rdoc === undefined) {
      throw new errors.UserError('Round not found');
    }
    return [mdoc, rdoc];
  };

  /**
   * Get round status from fun-judge exit code
   * @param  {Number} exitCode
   * @return {String}
   */
  MatchSchema.statics.getStatusFromJudgeExitCode = function(exitCode) {
    if (Match.JUDGE_EXITCODE_STATUS[exitCode] !== undefined) {
      return Match.JUDGE_EXITCODE_STATUS[exitCode];
    }
    return Match.STATUS_SYSTEM_ERROR;
  };

  let openingCache = {};

  /**
   * Get opening data from opening id
   * @param  {String} openingId
   * @return {String}
   */
  MatchSchema.statics.getOpeningFromIdAsync = async function(openingId) {
    if (!openingCache[openingId]) {
      const filePath = `./openings/${openingId}.json`;
      const content = await fsp.readFile(filePath);
      openingCache[openingId] = content.toString();
    }
    return openingCache[openingId];
  };

  /**
   * Generate initial round docs for a match
   * @return {[Match.Round]}
   */
  function generateRoundDocs() {
    const rounds = [];
    const ran_openings = [];
    for (let opening_i = 0; opening_i < DI.config.match.rounds; opening_i++) {
      const ran = Math.floor(Math.random() * DI.config.match.openings.length);
      ran_openings.push(DI.config.match.openings[ran]);
    }
    for (const openingId of ran_openings) {
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
   * Push a round task into the queue
   */
  async function publishRoundTaskAsync(mdoc, rdoc) {
    await DI.mq.publish('judge', {
      mdocid: String(mdoc._id),
      s1docid: String(mdoc.u1Submission),
      s2docid: String(mdoc.u2Submission),
      u1docid: String(mdoc.u1),
      u2docid: String(mdoc.u2),
      rid: rdoc._id,
      u1field: rdoc.u1Black ? 'black' : 'white',
      opening: await Match.getOpeningFromIdAsync(rdoc.openingId),
      rules: DI.config.match.rules,
    });
  }

  /**
   * Add all matches for a new submission. If the submission have related matches
   * previously, they will be removed.
   *
   * @param {Submission} s1
   * @param {User} u1
   * @param {[{_id: User, sdocid: Submission}]} s2u2docs
   */
  /*  MatchSchema.statics.addMatchesForSubmissionAsync = async function(
      s1, u1, s2u2docs) {
      await Match.remove({u1Submission: s1});
      if (s2u2docs.length === 0) {
        return [];
      }

      const endProfile = utils.profile('Match.addMatchesForSubmissionAsync',
        DI.config.profiling.addMatches);

      const mdocs = [];
      await Promise.all(s2u2docs.map(async s2u2doc => {
        const mdoc = new Match({
          status: Match.STATUS_PENDING,
          u1,
          u2: s2u2doc._id,
          u1Submission: s1,
          u2Submission: s2u2doc.sdocid,
          usedTime: 0,
          rounds: generateRoundDocs(),
        });
        await mdoc.save();
        // push each round of each match into the queue
        await Promise.all(
          mdoc.rounds.map(rdoc => publishRoundTaskAsync(mdoc, rdoc)));
        mdocs.push(mdoc);
      }));

      endProfile();

      return mdocs;
    };*/

  /**
   * Create a new match between two users
   * @param u1
   * @param u2
   * @returns {Promise<*>}
   */
  MatchSchema.statics.createMatchAsync = async function(u1, u2) {
    if (u1.isBusy()) {
      throw new Error(`${u1._id} is busy, unable to match`);
    }
    if (u2.isBusy()) {
      throw new Error(`${u2._id} is busy, unable to match`);
    }
    if (await DI.models.Rating.isUserBusyAsync(u1)) {
      throw new Error(`${u1._id} is busy, unable to match`);
    }
    if (await DI.models.Rating.isUserBusyAsync(u2)) {
      throw new Error(`${u2._id} is busy, unable to match`);
    }
    const s1 = await DI.models.Submission.getLastSubmissionByUserAsync(u1);
    if (s1 === null || s1.status !== DI.models.Submission.STATUS_EFFECTIVE) {
      throw new Error(`${u1._id} doesn't have a valid submission`);
    }
    const s2 = await DI.models.Submission.getLastSubmissionByUserAsync(u2);
    if (s2 === null || s2.status !== DI.models.Submission.STATUS_EFFECTIVE) {
      throw new Error(`${u2._id} doesn't have a valid submission`);
    }
    await u1.setBusyAsync();
    await u2.setBusyAsync();
    const mdoc = new Match({
      status: Match.STATUS_PENDING,
      u1,
      u2,
      u1Submission: s1,
      u2Submission: s2,
      rounds: generateRoundDocs(),
    });
    await mdoc.save();
    mdoc.u1Rating = await DI.models.Rating.createRatingAsync(mdoc, u1);
    mdoc.u2Rating = await DI.models.Rating.createRatingAsync(mdoc, u2);
    await mdoc.save();
    await s1.addMatchAsync(mdoc);
    await s2.addMatchAsync(mdoc);
    await Promise.all(
      mdoc.rounds.map(rdoc => publishRoundTaskAsync(mdoc, rdoc)));
    return mdoc;
  };

  /**
   * Reset match and regenerate rounds for a match.
   */
  /*MatchSchema.statics.rejudgeMatchAsync = async function(mdocid) {
    const mdoc = await Match.getMatchObjectByIdAsync(mdocid);
    mdoc.status = Match.STATUS_PENDING;
    mdoc.rounds = generateRoundDocs();
    await mdoc.save();
    await Promise.all(
      mdoc.rounds.map(rdoc => publishRoundTaskAsync(mdoc, rdoc)));
    return mdoc;
  };*/

  /**
   * Rejudge system error matches
   */
  /*
    MatchSchema.statics.rejudgeErrorMatchAsync = async function() {
      const mdocCursor = Match.find({status: Match.STATUS_SYSTEM_ERROR}).
        sort({_id: 1}).
        cursor();
      for (let mdoc = await mdocCursor.next(); mdoc !==
      null; mdoc = await mdocCursor.next()) {
        DI.logger.debug('Match.rejudgeErrorMatchAsync: %s', mdoc._id);
        await DI.models.Match.rejudgeMatchAsync(mdoc._id);
      }
      DI.logger.debug('Match.rejudgeErrorMatchAsync: done');
    };
  */

  /**
   * Translate MatchStatus into RelativeStatus
   *
   * @param  {String}  status
   * @param  {Boolean} isU1
   * @return {String}
   */
  MatchSchema.statics.getRelativeStatus = function(status, isU1 = true) {
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
  MatchSchema.methods.updateStatusAsync = async function() {
    const statusStat = {
      [Match.STATUS_PENDING]: 0,
      [Match.STATUS_RUNNING]: 0,
      [Match.STATUS_SYSTEM_ERROR]: 0,
      [Match.STATUS_U1WIN]: 0,
      [Match.STATUS_U2WIN]: 0,
      [Match.STATUS_DRAW]: 0,
    };
    let finishCount = 0;
    this.rounds.forEach(rdoc => {
      if (Match.isFinishStatus(rdoc.status)) {
        finishCount++;
      }
      statusStat[rdoc.status]++;
    });
    if (statusStat[Match.STATUS_PENDING] === this.rounds.length) {
      // all pending
      this.status = Match.STATUS_PENDING;
    } else if (statusStat[Match.STATUS_SYSTEM_ERROR] > 0) {
      // some system error
      this.status = Match.STATUS_SYSTEM_ERROR;
    } else if (statusStat[Match.STATUS_RUNNING] > 0 ||
      statusStat[Match.STATUS_PENDING] > 0) {
      // some pending, or some running
      this.status = Match.STATUS_RUNNING;
    }

    // match end, calculate rating
    if (finishCount === this.rounds.length) {
      // match end, calculate rating
      const u1Rating = await DI.models.Rating.getRatingObjectByIdAsync(this.u1Rating);
      const u2Rating = await DI.models.Rating.getRatingObjectByIdAsync(this.u2Rating);
      if (this.status === Match.STATUS_SYSTEM_ERROR) {
        // system error
        await u1Rating.setErrorAsync();
        await u2Rating.setErrorAsync();
      } else if (statusStat[Match.STATUS_U1WIN] >
        statusStat[Match.STATUS_U2WIN]) {
        // u1win
        this.status = Match.STATUS_U1WIN;
        await u1Rating.setWinAsync(this.u2Rating.before);
        await u2Rating.setLoseAsync(this.u1Rating.before);
      } else if (statusStat[Match.STATUS_U1WIN] <
        statusStat[Match.STATUS_U2WIN]) {
        // u2win
        this.status = Match.STATUS_U2WIN;
        await u1Rating.setLoseAsync(this.u2Rating.before);
        await u2Rating.setWinAsync(this.u1Rating.before);
      } else {
        // draw
        this.status = Match.STATUS_DRAW;
        await u1Rating.setDrawAsync();
        await u2Rating.setDrawAsync();
      }
      await u1Rating.save();
      await u2Rating.save();
    }
  };

  MatchSchema.statics.updateMatchStatusAsync = async function(mdocid) {
    const mdoc = await Match.getMatchObjectByIdAsync(mdocid);
    await mdoc.updateStatusAsync();
    await mdoc.save();
  };

  /**
   * Mark a pending round as running
   *
   * @param  {MongoId} mdocid Match Id
   * @param  {MongoId} rid Round Id
   * @return {Match}
   */
  MatchSchema.statics.judgeStartRoundAsync = async function(mdocid, rid) {
    const [mdoc, rdoc] = await Match.getRoundObjectByIdAsync(mdocid, rid);
    rdoc.status = Match.STATUS_RUNNING;
    rdoc.beginJudgeAt = new Date();
    await mdoc.save();
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
  MatchSchema.statics.judgeCompleteRoundAsync = async function(
    mdocid, rid, status, extra = {}) {
    if (!Match.isFinishStatus(status)) {
      throw new Error(`judgeCompleteRoundAsync: status ${status} is invalid`);
    }
    const [mdoc, rdoc] = await Match.getRoundObjectByIdAsync(mdocid, rid);
    rdoc.status = status;
    rdoc.endJudgeAt = new Date();
    if (!rdoc.beginJudgeAt) {
      rdoc.beginJudgeAt = new Date();
    }
    if (extra.logBlobStream) {
      // if a log stream is specified, put it into gridfs
      const file = await DI.gridfs.putBlobAsync(extra.logBlobStream, {
        contentType: 'text/plain',
        metadata: {
          type: 'match.log',
          match: mdocid,
          round: rid,
        },
      });
      extra.logBlob = file._id;
      extra.logBlobStream = null;
    }
    _.assign(rdoc, extra);
    await mdoc.save();
    return mdoc;
  };

  /**
   * Get all related matches for a submission
   * @param  {MongoId} sid
   * @return {[Cursor]}
   */
  MatchSchema.statics.getMatchesForSubmissionCursor = function(sid) {
    return Match.find({
      $or: [
        {u1Submission: sid},
        {u2Submission: sid},
      ],
    }).sort({_id: -1});
  };

  MatchSchema.statics.getUserMatches = function (uid) {
    return Match.find({
      $or: [
        {u1: uid},
        {u2: uid},
      ],
    }).sort({_id: -1});
  };

  MatchSchema.statics.getAllMatches = function() {
    return Match.find().sort({updatedAt: -1});
  };

  /**
   * Get all pending, running or system_error matches
   */
  MatchSchema.statics.getPendingMatchesAsync = async function(includePending = true) {
    const $in = [Match.STATUS_RUNNING, Match.STATUS_SYSTEM_ERROR];
    if (includePending) {
      $in.push(Match.STATUS_PENDING);
    }
    return await Match.find({
      status: {$in},
    }).sort({_id: -1}).exec();
  };

  /**
   * Update status of all matches
   */
  MatchSchema.statics.refreshAllMatchesAsync = async function() {
    let ret = {
      updated: 0,
      all: 0,
    };
    const cursor = Match.find().sort({_id: 1}).cursor();
    for (let mdoc = await cursor.next(); mdoc !==
    null; mdoc = await cursor.next()) {
      ret.all++;
      await mdoc.updateStatusAsync();
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
  MatchSchema.statics.getPairwiseMatchesAsync = async function(sids) {
    return await Match.find({
      u1Submission: {$in: sids},
      u2Submission: {$in: sids},
      status: {
        $in: [
          Match.STATUS_U1WIN,
          Match.STATUS_U2WIN,
          Match.STATUS_DRAW],
      },
    }).sort({_id: -1}).exec();
  };
  MatchSchema.statics.getPairwiseMatchesCursor = function(sids) {
    return Match.find({
      u1Submission: {$in: sids},
      u2Submission: {$in: sids},
      status: {
        $in: [
          Match.STATUS_U1WIN,
          Match.STATUS_U2WIN,
          Match.STATUS_DRAW],
      },
    }).sort({_id: -1}).cursor();
  };

  MatchSchema.index({u1Submission: 1, u2Submission: -1, status: 1, _id: -1},
    {unique: true});
  MatchSchema.index({u1Submission: 1, _id: -1});
  MatchSchema.index({u2Submission: 1, _id: -1});
  MatchSchema.index({status: 1, _id: -1});

  Match = mongoose.model('Match', MatchSchema);
  return Match;

}
