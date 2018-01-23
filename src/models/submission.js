import _ from 'lodash';
import fsp from 'fs-promise';
import uuid from 'uuid';
import moment from 'moment';
import mongoose from 'mongoose';
import utils from 'libs/utils';
import objectId from 'libs/objectId';
import errors from 'libs/errors';
import permissions from 'libs/permissions';

export default () => {
  const SubmissionSchema = new mongoose.Schema({
    user: {type: mongoose.Schema.Types.ObjectId, ref: 'User'},
    version: Number,  // nth submission of this user
    code: String,
    compiler: String,
    exeBlob: mongoose.Schema.Types.ObjectId,  // grid fs
    status: String,
    text: String,
    taskToken: String, // A unique token for compile task
    rejudge: Boolean,
    matches: [{type: mongoose.Schema.Types.ObjectId, ref: 'Match'}],
    matchStatus: String,
    totalUsedTime: Number,
    startRating: {type: mongoose.Schema.Types.ObjectId, ref: 'Rating'},
    endRating: {type: mongoose.Schema.Types.ObjectId, ref: 'Rating'},
    matchLogCleared: Boolean,
  }, {
    timestamps: true,
    toObject: {virtuals: true},
    toJSON: {virtuals: true},
  });

  // Submission Model
  let Submission;

  SubmissionSchema.statics.HOT_STATUS_COLD = 0;
  SubmissionSchema.statics.HOT_STATUS_GLOBAL_LIMIT = 1;
  SubmissionSchema.statics.HOT_STATUS_QUOTA_LIMIT = 2;
  SubmissionSchema.statics.HOT_STATUS_SUBMISSION_LIMIT = 3;
  SubmissionSchema.statics.HOT_STATUS_TIME_LIMIT = 4;

  SubmissionSchema.statics.STATUS_PENDING = 'pending';
  SubmissionSchema.statics.STATUS_COMPILING = 'compiling';
  SubmissionSchema.statics.STATUS_COMPILE_ERROR = 'ce';
  SubmissionSchema.statics.STATUS_SYSTEM_ERROR = 'se';
  SubmissionSchema.statics.STATUS_RUNNING = 'running';
  SubmissionSchema.statics.STATUS_EFFECTIVE = 'effective';
  SubmissionSchema.statics.STATUS_INACTIVE = 'inactive';

  SubmissionSchema.statics.STATUS_TEXT = {
    'pending': 'Pending',
    'compiling': 'Compiling',
    'ce': 'Compile Error',
    'se': 'System Error',
    'running': 'Running',
    'effective': 'Effective',
    'inactive': 'Inactive',
  };

  SubmissionSchema.pre('save', function(next) {
    this.__lastIsNew = this.isNew;
    this.__lastModifiedPaths = this.modifiedPaths();
    next();
  });

  SubmissionSchema.post('save', function() {
    const sdoc = this.toObject();
    Promise.all([
      (async () => {
        if (this.__lastIsNew) {
          await DI.eventBus.emitAsyncWithProfiling('submission:created::**',
            sdoc);
        }
      })(),
      ...this.__lastModifiedPaths.map(async (path) => {
        if (path === 'status') {
          await DI.eventBus.emitAsyncWithProfiling(
            'submission.status:updated::**', sdoc);
        } else if (path === 'matchStatus') {
          await DI.eventBus.emitAsyncWithProfiling(
            'submission.match.status:updated::**', sdoc);
        }
      }),
    ]);
  });

  /**
   * Update the submission status one by one when match status is updated
   */
  const updateStatusQueue = new utils.DedupWorkerQueue({
    delay: 1000,
    asyncWorkerFunc: sdocid => {
      return Submission.updateSubmissionStatusAsync(sdocid);
    },
  });

  /**
   * Update matchStatus when a match status is updated
   */
  DI.eventBus.on('match.status:updated', async mdoc => {
    try {
      await Submission.updateSubmissionMatchAsync(mdoc._id);
    } catch (err) {
      DI.logger.error(err.stack);
    }
  });

  /**
   * Enqueue submission status change when last match status is updated
   */
  DI.eventBus.on('submission.match.status:updated', async sdoc => {
    try {
      updateStatusQueue.push(String(sdoc._id));
    } catch (err) {
      DI.logger.error(err.stack);
    }
  });

  /**
   * Get the submission object by submission id
   * @return {Submission} Mongoose submission object
   */
  SubmissionSchema.statics.getSubmissionObjectByIdAsync = async function(
    id, projection = {}, throwWhenNotFound = true) {
    if (!objectId.isValid(id)) {
      if (throwWhenNotFound) {
        throw new Error(`Submission ${id} not valid`);
      } else {
        return null;
      }
    }
    const s = await Submission.findOne({_id: id}, projection);
    if (s === null && throwWhenNotFound) {
      throw new Error(`Submission ${id} not found`);
    }
    return s;
  };

  /**
   * Get all submissions sorted by id desc
   */
  SubmissionSchema.statics.getAllSubmissionsCursor = function() {
    return Submission.find({}).sort({_id: -1});
  };

  /**
   * Get all submissions of a user sorted by id desc
   */
  SubmissionSchema.statics.getUserSubmissionsCursor = function(uid) {
    return Submission.find({user: uid}).sort({_id: -1});
  };

  SubmissionSchema.statics.getExceptionSubmissionAsync = async function() {
    return Submission.find({
      status: {
        $in: [
          Submission.STATUS_RUNNING,
          Submission.STATUS_PENDING,
          Submission.STATUS_COMPILING,
        ],
      },
    }).exec();
  };

  SubmissionSchema.methods.resetExceptionAsync = async function() {
    

    if (this.status === Submission.STATUS_RUNNING) {
      // reset state to effective
      this.status = Submission.STATUS_EFFECTIVE;
      await this.save();
    } else if (this.status === Submission.STATUS_PENDING ||
      this.status === Submission.STATUS_COMPILING) {
      // resend compile request
      this.taskToken = null;
      await Submission.createCompileTaskAsync(this);
    }
  };

  /**
   * Check whether a user is allowed to submit new code
   *
   * @return {[Number, Any]}
   *         Number is HOT_STATUS
   *         for HOT_STATUS_GLOBAL_LIMIT, 2nd element is the reason
   *         for HOT_STATUS_QUOTA_LIMIT, 2nd element is the quota used
   *         for HOT_STATUS_TIME_LIMIT, 2nd element is the remaining time
   */
  SubmissionSchema.statics.isUserAllowedToSubmitAsync = async function(uid) {
    const udoc = await DI.models.User.getUserObjectByIdAsync(uid);

    // Global submission lock?
    const lockdoc = await DI.models.Sys.getAsync('lock_submission', false);
    if (lockdoc && !udoc.hasPermission(permissions.BYPASS_SUBMISSION_LOCK)) {
      const reason = await DI.models.Sys.getAsync('lock_submission_reason',
        'Unknown');
      return [Submission.HOT_STATUS_GLOBAL_LIMIT, reason];
    }

    // Submission quota limit?
    /*const usedTime = await Submission.getUsedSubmissionQuotaAsync(uid);
    if (usedTime > DI.config.compile.limits.maxExecQuota &&
      !udoc.hasPermission(permissions.BYPASS_SUBMISSION_QUOTA)) {
      return [Submission.HOT_STATUS_QUOTA_LIMIT, usedTime];
    }*/

    // No last submission?
    const sdocs = await Submission.getUserSubmissionsCursor(uid).
      limit(1).
      exec();
    if (sdocs.length === 0) {
      return [Submission.HOT_STATUS_COLD];
    }

    // Last submission is CE?
    const last = sdocs[0];
    if (last.status === Submission.STATUS_COMPILE_ERROR) {
      return [Submission.HOT_STATUS_COLD];
    }

    let limit;

    // In JI Gomoku there is no limit for this
    // Last submission is running?
    /*if (last.status === Submission.STATUS_PENDING
      || last.status === Submission.STATUS_COMPILING
      || last.status === Submission.STATUS_RUNNING) {
      return [Submission.HOT_STATUS_SUBMISSION_LIMIT];
    }*/

    // Submission interval limit?
    if (udoc.hasPermission(permissions.BYPASS_SUBMISSION_LIMIT)) {
      limit = DI.config.compile.limits.minSubmitInterval || 1000;
    } else {
      limit = DI.config.compile.limits.submitInterval;
    }
    const interval = Date.now() - last.createdAt.getTime();
    const remaining = limit - interval;
    if (remaining > 0) {
      return [Submission.HOT_STATUS_TIME_LIMIT, remaining];
    }

    return [Submission.HOT_STATUS_COLD];
  };

  /**
   * Submit new code and create compile task
   *
   * @return {Submission}
   */
  SubmissionSchema.statics.createSubmissionAsync = async function(
    uid, code, compiler) {
    const [hotStatus] = await Submission.isUserAllowedToSubmitAsync(uid);
    if (hotStatus !== Submission.HOT_STATUS_COLD) {
      throw new errors.UserError(
        'You are not allowed to submit new code currently.');
    }
    if (code.length > DI.config.compile.limits.sizeOfCode) {
      throw new errors.ValidationError('Your source code is too large.');
    }
    const version = await DI.models.User.incAndGetSubmissionNumberAsync(uid);
    const sdoc = new Submission({
      user: uid,
      version,
      code,
      compiler,
      status: Submission.STATUS_PENDING,
      text: '',
      rejudge: false,
      totalUsedTime: 0,
    });
    await Submission.createCompileTaskAsync(sdoc);
    return sdoc;
  };

  /**
   * Recompile a submission
   */
  /*SubmissionSchema.statics.recompileAsync = async function(sid) {
    const sdoc = await Submission.getSubmissionObjectByIdAsync(sid);
    const csdocs = await Submission.find(
      {
        status: Submission.STATUS_COMPILING,
        _id: {$lte: objectId.fromDatetime(sdoc._id.getTimestamp())},
      },
      {_id: 1},
    );
    if (csdocs.length !== 0) {
      const csids = _.map(csdocs, csdoc =_compileForMatchAsync> csdoc._id.toString());
      throw new Error(
        `Those submissions should be recompiled first: ${csids.join(', ')}`);
    }
    sdoc.text = '';
    sdoc.taskToken = null;
    sdoc.matches = null;
    sdoc.rejudge = true;
    await Submission.createCompileTaskAsync(sdoc);
    return sdoc;
  };*/

  /**
   * Create a compile task for the submission
   * @return {Submission} The new submission object
   */
  SubmissionSchema.statics.createCompileTaskAsync = async function(sdoc) {
    if (sdoc.taskToken) {
      const error = new Error(
        'createCompileTaskAsync: Expect taskToken is undefined');
      DI.logger.error(error.stack);
    }
    sdoc.exeBlob = null;
    sdoc.status = Submission.STATUS_PENDING;
    sdoc.text = '';
    sdoc.taskToken = uuid.v4();
    await sdoc.save();
    await DI.mq.publish('compile', {
      sdocid: String(sdoc._id),
      token: sdoc.taskToken,
      limits: DI.config.compile.limits,
    });
    return sdoc;
  };

  /**
   * Get each users' last effective or running submission
   *
   * @param  {Boolean} onlyEffective
   * @return {[{_id, sdocid}]}
   */
  SubmissionSchema.statics.getLastSubmissionsByUserAsync = async function(
    onlyEffective = true, maxDatetime = null) {
    const matchExp = {};
    if (onlyEffective) {
      matchExp.status = Submission.STATUS_EFFECTIVE;
    } else {
      matchExp.status = {
        $in: [
          Submission.STATUS_RUNNING,
          Submission.STATUS_EFFECTIVE],
      };
    }
    if (maxDatetime) {
      matchExp._id = {$lte: objectId.fromDatetime(maxDatetime)};
    }
    return await Submission.aggregate([
      {$match: matchExp},
      {$sort: {_id: -1}},
      {$project: {user: 1, createdAt: 1, status: 1}},
      {$group: {_id: '$user', sdocid: {$first: '$_id'}}},
    ]).allowDiskUse(true).exec();
  };

  SubmissionSchema.statics.getLastSubmissionByUserAsync = async function(user) {
    return await Submission.findOne({
      status: {$in: [Submission.STATUS_RUNNING, Submission.STATUS_EFFECTIVE]},
      user,
    }).sort({createdAt: -1}).exec();
  };

  /**
   * Set all of the user's pending and effective submission inactive
   * @param user
   * @returns {Promise<void>}
   */
  SubmissionSchema.statics.markSubmissionByUserInactiveAsync = async function(user) {
    await Submission.update({
      status: {
        $in: [
          Submission.STATUS_PENDING,
          Submission.STATUS_EFFECTIVE,
        ],
      },
      user,
    }, {$set: {status: Submission.STATUS_INACTIVE}});
  };

  /**
   * Shrink the log of matches in previous submissions
   */
  SubmissionSchema.statics.shrink = async function() {
    DI.logger.info('Collecting last submissions...');
    const lsdocs = await DI.models.Submission.getLastSubmissionsByUserAsync();
    const sdocWhitelist = {};
    lsdocs.forEach(lsdoc => sdocWhitelist[lsdoc.sdocid.toString()] = true);

    const fsFiles = DI.mongodbConnection.collection('fs.files');
    const fsChunks = DI.mongodbConnection.collection('fs.chunks');

    let shrinked = 0;
    const n = await DI.models.Submission.count({});
    const sdocs = await DI.models.Submission.find({},
      {status: 1, matchLogCleared: 1}).sort({_id: 1}).exec();
    for (const sdoc of sdocs) {
      if (sdoc.matchLogCleared === true) {
        DI.logger.info('[%d / %d] Ignored processed submission %s', ++shrinked,
          n, sdoc._id);
      } else if (sdoc.status !== Submission.STATUS_EFFECTIVE) {
        DI.logger.info('[%d / %d] Ignored non-effective submission %s',
          ++shrinked, n, sdoc._id);
      } else if (sdocWhitelist[sdoc._id.toString()]) {
        DI.logger.info('[%d / %d] Ignored last submission %s', ++shrinked, n,
          sdoc._id);
      } else {
        DI.logger.warn('[%d / %d] Shrinking submission %s...', ++shrinked, n,
          sdoc._id);
        const mdocCursor = DI.models.Match.find({u1Submission: sdoc._id},
          {'rounds.logBlob': 1}).sort({_id: 1}).cursor();
        for (let mdoc = await mdocCursor.next(); mdoc !==
        null; mdoc = await mdocCursor.next()) {
          if (mdoc.rounds) {
            const filesToRemove = [];
            for (let round of mdoc.rounds) {
              if (round.logBlob) {
                filesToRemove.push(round.logBlob);
                round.logBlob = null;
              }
            }
            try {
              await fsFiles.remove({_id: {$in: filesToRemove}});
              await fsChunks.remove({files_id: {$in: filesToRemove}});
            } catch (err) {
              DI.logger.error(err);
            }
            await mdoc.save();
          }
        }
        sdoc.matchLogCleared = true;
        await sdoc.save();
      }
    }
  };

  /**
   * Export everyone's latest code
   */
  SubmissionSchema.statics.exportCode = async function(location = '') {
    const directory = location + '/export_' +
      moment().format('YYYY-MM-DD-HH-mm');
    await fsp.ensureDir(directory);
    const lsdocs = await Submission.getLastSubmissionsByUserAsync();
    for (const lsdoc of lsdocs) {
      DI.logger.info('%s', lsdoc.sdocid);
      const sdoc = await Submission.getSubmissionObjectByIdAsync(lsdoc.sdocid);
      await sdoc.populate('user').execPopulate();
      await fsp.writeFile(
        `${directory}/${sdoc.user.profile.studentId}_${sdoc.user.profile.realName}.c`,
        sdoc.code);
    }
    DI.logger.info('Done.');
  };

  /**
   * Mark a submission as compiling and return the submission if the given taskToken
   * matches the submission
   *
   * @param  {MongoId} sid
   * @param  {String} taskToken
   * @return {Submission}
   */
  SubmissionSchema.statics.judgeStartCompileAsync = async function(
    sid, taskToken) {
    const sdoc = await Submission.getSubmissionObjectByIdAsync(sid);
    if (sdoc.taskToken !== taskToken) {
      throw new errors.UserError(
        'judgeStartCompileAsync: Task token does not match');
    }
    sdoc.status = Submission.STATUS_COMPILING;
    await sdoc.save();
    return sdoc;
  };

  /**
   * Mark a submission as System Error
   *
   * @param  {MongoId} sid
   * @param  {String} taskToken
   * @param  {String} text
   * @return {Submission}
   */
  SubmissionSchema.statics.judgeSetSystemErrorAsync = async function(
    sid, taskToken, text) {
    const sdoc = await Submission.getSubmissionObjectByIdAsync(sid);
    if (sdoc.taskToken !== taskToken) {
      throw new errors.UserError(
        'judgeSetSystemErrorAsync: Task token does not match');
    }
    sdoc.text = text;
    sdoc.status = Submission.STATUS_SYSTEM_ERROR;
    sdoc.taskToken = null;
    await sdoc.save();
    return sdoc;
  };

  /**
   * Mark a submission as Compile Error or Effective and return the submission if the
   * given taskToken matches the submission. For success compiling, it will prepare
   * matches and push match task to the queue.
   *
   * @param  {MongoId} sid
   * @param  {String} taskToken
   * @param  {Boolean} success
   * @param  {String} text
   * @param  {MongoId} exeBlobId
   * @return {Submisison}
   */
  SubmissionSchema.statics.judgeCompleteCompileAsync = async function(
    sid, taskToken, success, text, exeBlobId = null) {
    if (!success && exeBlobId !== null) {
      throw new Error(
        'judgeCompleteCompileAsync: No executable should be supplied');
    }
    const sdoc = await Submission.getSubmissionObjectByIdAsync(sid);
    if (sdoc.taskToken !== taskToken) {
      throw new errors.UserError(
        'judgeCompleteCompileAsync: Task token does not match');
    }
    sdoc.text = text;
    sdoc.status = success
      ? Submission.STATUS_EFFECTIVE
      : Submission.STATUS_COMPILE_ERROR;
    if (success && exeBlobId !== null) {
      sdoc.exeBlob = exeBlobId;
    }

    // Set all of pending and effective submission to inactive if success
    if (success) {
      await Submission.markSubmissionByUserInactiveAsync(sdoc.user);
      await DI.models.User.setMatchPriorityInitialAsync(sdoc.user, sdoc);
      try {
        await DI.models.Rating.initUserRatingAsync(sdoc.user);
      } catch (e) {
        (e => e)(); // is it interesting ?
      }
    }
    await sdoc.save();

    // don't create match when compiled in JI Gomoku
    /*if (success) {
      const mdocs = await Submission._createMatchAsync(sdoc);
      sdoc.matches = _.map(mdocs, mdoc => ({
        _id: mdoc._id,
        status: mdoc.status,
        usedTime: 0,
      }));
      await sdoc.save();
    }*/
    return sdoc;
  };

  /**
   * Create related matches for specified submission
   */
  /*  SubmissionSchema.statics._createMatchAsync = async function(sdoc) {
      const lsdocs = await Submission.getLastSubmissionsByUserAsync(false,
        sdoc._id.getTimestamp());
      const mdocs = await DI.models.Match.addMatchesForSubmissionAsync(
        sdoc._id,
        sdoc.user,
        _.filter(lsdocs, lsdoc => !lsdoc._id.equals(sdoc.user)),
      );
      if (mdocs.length === 0) {
        // no matches are added, mark sdoc as effective
        sdoc.status = Submission.STATUS_EFFECTIVE;
        await sdoc.save();
      }
      return mdocs;
    };*/

  /**
   * Update the status of the submission based on status of matches.
   * Status will be changed only from `running` to `effective`, or reversed.
   */
  SubmissionSchema.methods.updateStatusAsync = async function() {
    if (this.status !== Submission.STATUS_RUNNING &&
      this.status !== Submission.STATUS_EFFECTIVE) {
      return;
    }
    if (!this.matches || !this.matches.length) {
      return;
    }
    // Each submission can only have one match active (the last match)
    const mdoc = await DI.models.Match.getMatchObjectByIdAsync(
      _.last(this.matches));
    if (DI.models.Match.isFinishStatus(mdoc.status)) {
      await Submission.incrUsedSubmissionQuotaAsync(this.user, mdoc.usedTime);
      const sdoc = await Submission.getLastSubmissionByUserAsync(this.user);
      // if the submission isn't last effective submission, set it to inactive
      if (sdoc.equals(this)) {
        this.status = Submission.STATUS_EFFECTIVE;
      } else {
        this.status = Submission.STATUS_INACTIVE;
      }
      const rdoc = await DI.models.Rating.getRatingObjectByIdAsync(
        this.getSelfRating(mdoc));
      this.endRating = rdoc._id;
      await this.save();
      const udoc = await DI.models.User.updateRatingAsync(this.user, rdoc);
      DI.logger.info(
        `Submission ${this._id} by user ${udoc.profile.displayName}(${udoc._id})` +
        ` ended a match, rating ${rdoc.before}=>${rdoc.after}`,
      );
    } else {
      this.status = Submission.STATUS_RUNNING;
    }
  };

  /**
   * Called one by one after a match ends
   * @param sdocid
   * @returns {Promise<void>}
   */
  SubmissionSchema.statics.updateSubmissionStatusAsync = async function(sdocid) {
    const sdoc = await Submission.getSubmissionObjectByIdAsync(sdocid);
    await sdoc.updateStatusAsync();
    await sdoc.save();
  };

  /**
   * JI Gomoku: Get the submission user's latest rating
   * @param mdoc
   * @returns Object
   */
  SubmissionSchema.methods.getSelfRating = function(mdoc) {
    if (this.user.equals(mdoc.u1)) {
      return mdoc.u1Rating;
    } else if (this.user.equals(mdoc.u2)) {
      return mdoc.u2Rating;
    }
    throw new Error(`Both users not found in mdoc: ${mdoc._id}`);
  };

  /**
   * JI Gomoku: add a match for the submission
   * @param mdoc
   * @returns {Promise<void>}
   */
  SubmissionSchema.methods.addMatchAsync = async function(mdoc) {
    if (this.status !== Submission.STATUS_EFFECTIVE) {
      throw new Error('Submission not effective, unable to add match');
    }
    if (this.matches.length === 0) {
      this.startRating = this.getSelfRating(mdoc);
    } else {
      const _mdoc = await DI.models.Match.getMatchObjectByIdAsync(
        _.last(this.matches));
      if (!DI.models.Match.isFinishStatus(_mdoc.status)) {
        throw new Error('Previous match not finished, unable to add match');
      }
    }
    this.matches.push(mdoc);
    this.matchStatus = mdoc.status;
    await this.save();
  };

  /**
   * Update a submission according to the match
   * @param sdocid
   * @param mdoc
   */
  SubmissionSchema.statics.updateByMatchAsync = async function(sdocid, mdoc) {
    const sdoc = await Submission.getSubmissionObjectByIdAsync(sdocid);
    if (!sdoc.matches) {
      // Only compiled submission contains `matches`
      return;
    }
    const lastMatch = _.last(sdoc.matches);
    if (!mdoc.equals(lastMatch)) {
      // not the latest match
      throw new Error('not the latest match');
    }
    sdoc.matchStatus = mdoc.status;
    sdoc.save();
  };

  /**
   * Update the status of a smdoc according to the status of mdoc
   * @param  {ObjectId} mdocid
   */
  SubmissionSchema.statics.updateSubmissionMatchAsync = async function(mdocid) {
    const mdoc = await DI.models.Match.getMatchObjectByIdAsync(mdocid);
    if (mdoc.status !== DI.models.Match.STATUS_PENDING) {
      await Submission.updateByMatchAsync(mdoc.u1Submission, mdoc);
      await Submission.updateByMatchAsync(mdoc.u2Submission, mdoc);
    }
  };

  /**
   * Get all pending, running, compiling or system_error matches
   */
  SubmissionSchema.statics.getPendingSubmissionsCursor = function() {
    return Submission.find({
      status: {
        $in: [
          Submission.STATUS_PENDING,
          Submission.STATUS_RUNNING,
          Submission.STATUS_COMPILING,
          Submission.STATUS_SYSTEM_ERROR],
      },
    }).sort({_id: -1});
  };

  /**
   * Get used submission quota of a user
   *
   * @param  {ObjectId} uid
   * @return {Number}
   */
  SubmissionSchema.statics.getUsedSubmissionQuotaAsync = async function(uid) {
    const result = parseInt(await DI.redis.getAsync(`used_quota:${uid}`));
    if (isNaN(result)) {
      return 0;
    }
    return result;
  };

  /**
   * Increase used submission quota of a user
   *
   * @param  {ObjectId} uid
   * @param  {Number} usedTime used time in milliseconds
   */
  SubmissionSchema.statics.incrUsedSubmissionQuotaAsync = async function(
    uid, usedTime) {
    return await DI.redis.multi().
      incrby(`used_quota:${uid}`, usedTime).
      expireat(`used_quota:${uid}`, moment().add(1, 'd').startOf('day').unix()).
      execAsync();
  };

  SubmissionSchema.index({user: 1, _id: -1});
  SubmissionSchema.index({status: 1, _id: -1});

  Submission = mongoose.model('Submission', SubmissionSchema);
  return Submission;

};
