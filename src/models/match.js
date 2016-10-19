import _ from 'lodash';
import fsp from 'fs-promise';
import mongoose from 'mongoose';
import objectId from 'libs/objectId';
import errors from 'libs/errors';

export default () => {
  const MatchSchema = new mongoose.Schema({
    status: String,
    u1: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    u2: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    u1Submission: { type: mongoose.Schema.Types.ObjectId, ref: 'Submission' },
    u2Submission: { type: mongoose.Schema.Types.ObjectId, ref: 'Submission' },
    u1Stat: { // only exists after match is completed
      score: Number,
      win: Number,
      lose: Number,
      draw: Number,
    },
    u2Stat: { // only exists after match is completed
      score: Number,
      win: Number,
      lose: Number,
      draw: Number,
    },
    rounds: [{
      _id: mongoose.Schema.Types.ObjectId,
      status: String,
      u1Black: Boolean,
      u2Black: Boolean, // !u1Black
      mapId: String,
      beginJudgeAt: Date,
      endJudgeAt: Date,
      logBlob: mongoose.Schema.Types.ObjectId,  // grid fs
      text: String,
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

  /**
   * Update the match status when round status is updated
   */
  MatchSchema.pre('save', function (next) {
    const modifiedPaths = this.modifiedPaths();
    if (_.some(modifiedPaths, path => path.match(/^rounds\.\d+\.status$/))) {
      this.updateMatchStatus();
    }
    next();
  });

  /**
   * Broadcast match status changed event when it is changed
   */
  MatchSchema.pre('save', function (next) {
    if (this.isModified('status')) {
      setTimeout(() => DI.eventBus.emit('match.statusChanged', this), 1000);
    }
    next();
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
   * Get initial map content from map id
   * @param  {String} mapId
   * @return {String}
   */
  MatchSchema.statics.getMapFromIdAsync = async function (mapId) {
    const filePath = `./maps/${mapId}.json`;
    const mapContent = await fsp.readFile(filePath);
    return mapContent.toString();
  };

  /**
   * Generate initial round docs for a match
   * @return {[Match.Round]}
   */
  function generateRoundDocs() {
    const rounds = [];
    for (const mapId of DI.config.match.maps) {
      for (const u1Black of [true, false]) {
        rounds.push({
          _id: mongoose.Types.ObjectId(),
          status: Match.STATUS_PENDING,
          u1Black,
          u2Black: !u1Black,
          mapId: String(mapId),
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
    if (s2u2docs.length === 0) {
      return [];
    }
    await Match.remove({ u1Submission: s1 });
    const mdocs = await Match.insertMany(s2u2docs.map(s2u2doc => ({
      status: Match.STATUS_PENDING,
      u1,
      u2: s2u2doc._id,
      u1Submission: s1,
      u2Submission: s2u2doc.sdocid,
      rounds: generateRoundDocs(),
    })));
    // push each round of each match into the queue
    for (const match of mdocs) {
      for (const round of match.rounds) {
        await DI.mq.publish('judge', {
          mdocid: String(match._id),
          s1docid: String(match.u1Submission),
          s2docid: String(match.u2Submission),
          rid: round._id,
          u1field: round.u1Black ? 'black' : 'white',
          map: await Match.getMapFromIdAsync(round.mapId),
          rules: DI.config.match.rules,
        });
      }
    }
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
   * Get score according to wins and draws
   */
  function getScore(win, draw) {
    return win * 3 + draw * 1;
  }

  /**
   * Update match status according to round status
   */
  MatchSchema.methods.updateMatchStatus = function () {
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
      this.status = Match.DRAW;
    }
    // Update u1Stat and u2Stat
    this.u1Stat = {
      win: statusStat[Match.STATUS_U1WIN],
      lose: statusStat[Match.STATUS_U2WIN],
      draw: statusStat[Match.STATUS_DRAW],
    };
    this.u1Stat.score = getScore(this.u1Stat.win, this.u1Stat.draw);
    this.u2Stat = {
      win: statusStat[Match.STATUS_U2WIN],
      lose: statusStat[Match.STATUS_U1WIN],
      draw: statusStat[Match.STATUS_DRAW],
    };
    this.u2Stat.score = getScore(this.u2Stat.win, this.u2Stat.draw);
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
   * @param  {MongoId} logBlobId
   * @return {Match}
   */
  MatchSchema.statics.judgeCompleteRoundAsync = async function (mdocid, rid, status, logBlobId = null, text = null) {
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
      if (logBlobId !== null) {
        round.logBlob = logBlobId;
      }
      if (text !== null) {
        round.text = text;
      }
      round.endJudgeAt = new Date();
      if (!round.beginJudgeAt) {
        round.beginJudgeAt = new Date();
      }
      await mdoc.save();
    }
    return mdoc;
  };

  /**
   * Get all related matches for a submission
   * @param  {MongoId} sid
   * @return {[Match]}
   */
  MatchSchema.statics.getMatchesForSubmission = async function (sid) {
    const mdocs = await Match.find({
      $or: [
        { u1Submission: sid },
        { u2Submission: sid },
      ],
    }).sort({ _id: -1 }).limit(20);
    return mdocs;
  };

  /**
   * Update status of all matches
   */
  MatchSchema.statics.refreshAllMatches = async function () {
    let ret = {
      updated: 0,
      all: 0,
    };
    const cursor = Match.find().sort({ _id: 1 }).cursor();
    for (let mdoc = await cursor.next(); mdoc !== null; mdoc = await cursor.next()) {
      ret.all++;
      mdoc.updateMatchStatus();
      if (mdoc.isModified('status')) {
        ret.updated++;
        await mdoc.save();
      }
    }
    return ret;
  };

  MatchSchema.index({ u1Submission: 1, u2Submission: -1 }, { unique: true });
  MatchSchema.index({ u2Submission: 1 });

  Match = mongoose.model('Match', MatchSchema);
  return Match;

};
