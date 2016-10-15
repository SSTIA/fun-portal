import mongoose from 'mongoose';

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
      initialMapId: String,
      beginJudgeAt: Date,
      endJudgeAt: Date,
      logs: String,
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
   * Generate initial round docs for a match
   * @return {[Match.Round]}
   */
  function generateRoundDocs() {
    const rounds = [];
    for (const mapId of DI.config.match.initialMaps) {
      for (const u1Black of [true, false]) {
        rounds.push({
          _id: mongoose.Types.ObjectId(),
          status: MatchSchema.statics.STATUS_PENDING,
          u1Black,
          u2Black: !u1Black,
          initialMapId: String(mapId),
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
   * @param {[{_id: User, submissionId: Submission}]} s2u2docs
   */
  MatchSchema.statics.addMatchesForSubmissionAsync = async function (s1, u1, s2u2docs) {
    await this.remove({ u1Submission: s1 });
    const mdocs = s2u2docs.map(s2u2doc => ({
      status: this.STATUS_PENDING,
      u1,
      u2: s2u2doc._id,
      u1Submission: s1,
      u2Submission: s2u2doc.submissionId,
      rounds: generateRoundDocs(),
    }));
    return await this.insertMany(mdocs);
  };

  MatchSchema.index({ u1Submission: 1, u2Submission: -1 }, { unique: true });

  return mongoose.model('Match', MatchSchema);
};
