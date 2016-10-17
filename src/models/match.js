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

  // For both match and round
  MatchSchema.statics.STATUS_PENDING = 'pending';
  MatchSchema.statics.STATUS_RUNNING = 'running';
  MatchSchema.statics.STATUS_SYSTEM_ERROR = 'se';
  MatchSchema.statics.STATUS_U1WIN = 'u1win';
  MatchSchema.statics.STATUS_U2WIN = 'u2win';
  MatchSchema.statics.STATUS_DRAW = 'draw';

  MatchSchema.statics.JUDGE_EXITCODE_STATUS = {
    1: MatchSchema.statics.STATUS_U1WIN,
    2: MatchSchema.statics.STATUS_U2WIN,
    3: MatchSchema.statics.STATUS_DRAW,
    4: MatchSchema.statics.STATUS_SYSTEM_ERROR,
  };

  MatchSchema.statics.STATUS_TEXT = {
    'pending': 'Pending',
    'running': 'Running',
    'se': 'System Error',
    'u1win': 'Win',
    'u2win': 'Lose',
    'draw': 'Draw',
  };

  MatchSchema.statics.ROUND_STATUS_TEXT = {
    'pending': '(Pending)',
    'running': '(Running)',
    'se': '(Error)',
    'u1win': '',
    'u2win': '',
    'draw': '',
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
    const s = await this.findOne({ _id: id }, projection).exec();
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
    if (this.JUDGE_EXITCODE_STATUS[exitCode] !== undefined) {
      return this.JUDGE_EXITCODE_STATUS[exitCode];
    }
    return this.STATUS_SYSTEM_ERROR;
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
          status: MatchSchema.statics.STATUS_PENDING,
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
    await this.remove({ u1Submission: s1 });
    const mdocs = await this.insertMany(s2u2docs.map(s2u2doc => ({
      status: this.STATUS_PENDING,
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
          map: await this.getMapFromIdAsync(round.mapId),
          rules: DI.config.match.rules,
        });
      }
    }
    return mdocs;
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
      [MatchSchema.statics.STATUS_PENDING]: 0,
      [MatchSchema.statics.STATUS_RUNNING]: 0,
      [MatchSchema.statics.STATUS_SYSTEM_ERROR]: 0,
      [MatchSchema.statics.STATUS_U1WIN]: 0,
      [MatchSchema.statics.STATUS_U2WIN]: 0,
      [MatchSchema.statics.STATUS_DRAW]: 0,
    };
    this.rounds.forEach(rdoc => statusStat[rdoc.status]++);
    if (statusStat[MatchSchema.statics.STATUS_PENDING] === this.rounds.length) {
      // all pending
      this.status = MatchSchema.statics.STATUS_PENDING;
      return;
    }
    if (statusStat[MatchSchema.statics.STATUS_SYSTEM_ERROR] > 0) {
      // some system error
      this.status = MatchSchema.statics.STATUS_SYSTEM_ERROR;
      return;
    }
    if (statusStat[MatchSchema.statics.STATUS_RUNNING] > 0 || statusStat[MatchSchema.statics.STATUS_PENDING] > 0) {
      // some pending, or some running
      this.status = MatchSchema.statics.STATUS_RUNNING;
      return;
    }
    if (statusStat[MatchSchema.statics.STATUS_U1WIN] > statusStat[MatchSchema.statics.STATUS_U2WIN]) {
      this.status = MatchSchema.statics.STATUS_U1WIN;
    } else if (statusStat[MatchSchema.statics.STATUS_U1WIN] < statusStat[MatchSchema.statics.STATUS_U2WIN]) {
      this.status = MatchSchema.statics.STATUS_U2WIN;
    } else {
      this.status = MatchSchema.statics.DRAW;
    }
    // Update u1Stat and u2Stat
    this.u1Stat = {
      win: statusStat[MatchSchema.statics.STATUS_U1WIN],
      lose: statusStat[MatchSchema.statics.STATUS_U2WIN],
      draw: statusStat[MatchSchema.statics.STATUS_DRAW],
    };
    this.u1Stat.score = getScore(this.u1Stat.win, this.u1Stat.draw);
    this.u2Stat = {
      win: statusStat[MatchSchema.statics.STATUS_U2WIN],
      lose: statusStat[MatchSchema.statics.STATUS_U1WIN],
      draw: statusStat[MatchSchema.statics.STATUS_DRAW],
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
    const mdoc = await this.getMatchObjectByIdAsync(mdocid);
    const round = mdoc.rounds.find(rdoc => rdoc._id.equals(rid));
    if (round !== undefined) {
      if (round.status !== this.STATUS_PENDING) {
        DI.logger.error(`judgeStartRoundAsync: round ${rid} of match ${mdocid} is not in pending state (state = ${round.status})`);
        return;
      }
      round.status = this.STATUS_RUNNING;
      round.beginJudgeAt = new Date();
      mdoc.updateMatchStatus();
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
    if (status !== this.STATUS_U1WIN && status !== this.STATUS_U2WIN && status !== this.STATUS_DRAW && status !== this.STATUS_SYSTEM_ERROR) {
      throw new Error(`judgeCompleteRoundAsync: status ${status} is invalid`);
    }
    const mdoc = await this.getMatchObjectByIdAsync(mdocid);
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
      mdoc.updateMatchStatus();
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
    const mdocs = await this.find({
      $or: [
        { u1Submission: sid },
        { u2Submission: sid },
      ],
    });
    return mdocs;
  };

  MatchSchema.index({ u1Submission: 1, u2Submission: -1 }, { unique: true });
  MatchSchema.index({ u2Submission: 1 });

  return mongoose.model('Match', MatchSchema);
};
