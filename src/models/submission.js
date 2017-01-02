import _ from 'lodash';
import uuid from 'uuid';
import moment from 'moment';
import mongoose from 'mongoose';
import utils from 'libs/utils';
import objectId from 'libs/objectId';
import errors from 'libs/errors';
import permissions from 'libs/permissions';

export default () => {
  const SubmissionSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    version: Number,  // nth submission of this user
    code: String,
    compiler: String,
    exeBlob: mongoose.Schema.Types.ObjectId,  // grid fs
    status: String,
    text: String,
    taskToken: String,    // A unique token for each task, so that duplicate tasks
                          // won't be judged multiple times
    rejudge: Boolean,
    matches: [{
      _id: mongoose.Schema.Types.ObjectId,
      status: String,
      usedTime: Number,
    }],
    matchLogCleared: Boolean,
  }, {
    timestamps: true,
    toObject: { virtuals: true },
    toJSON: { virtuals: true },
  });

  /**
   * Get total used time based on used time of each match
   */
  SubmissionSchema.virtual('totalUsedTime').get(function () {
    return _.sumBy(this.matches, 'usedTime');
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

  SubmissionSchema.statics.STATUS_TEXT = {
    'pending': 'Pending',
    'compiling': 'Compiling',
    'ce': 'Compile Error',
    'se': 'System Error',
    'running': 'Running',
    'effective': 'Effective',
  };

  SubmissionSchema.pre('save', function (next) {
    this.__lastIsNew = this.isNew;
    this.__lastModifiedPaths = this.modifiedPaths();
    next();
  });

  SubmissionSchema.post('save', function () {
    const sdoc = this.toObject();
    Promise.all([
      (async () => {
        if (this.__lastIsNew) {
          await DI.eventBus.emitAsyncWithProfiling('submission:created::**', sdoc);
        }
      })(),
      ...this.__lastModifiedPaths.map(async (path) => {
        let m;
        if (path === 'status') {
          await DI.eventBus.emitAsyncWithProfiling('submission.status:updated::**', sdoc);
        } else if (m = path.match(/^matches\.(\d+)\.status$/)) {
          const smdoc = sdoc.matches[m[1]];
          await DI.eventBus.emitAsyncWithProfiling('submission.matches.status:updated::**', sdoc, smdoc);
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

  DI.eventBus.on('submission.matches.status:updated', sdoc => {
    updateStatusQueue.push(String(sdoc._id));
  });

  /**
   * Update corresponding smdoc status when a match status is updated
   */
  DI.eventBus.on('match.status:updated', async mdoc => {
    try {
      await Submission.updateSubmissionMatchAsync(mdoc._id);
    } catch (err) {
      DI.logger.error(err.stack);
    }
  });

  /**
   * Update today's quota when a submission status is updated
   * Notice that there is a window between submission_status_updated and quota_updated
   */
  DI.eventBus.on('submission.status:updated', async sdoc => {
    if (sdoc.status === Submission.STATUS_EFFECTIVE && !sdoc.rejudge) {
      Submission.incrUsedSubmissionQuotaAsync(sdoc.user, sdoc.totalUsedTime);
    }
  });

  /**
   * Update the status of the submission based on status of matches.
   * Status will be changed only from `running` to `effective`, or reversed.
   */
  SubmissionSchema.methods.updateStatus = function () {
    if (this.status !== Submission.STATUS_RUNNING && this.status !== Submission.STATUS_EFFECTIVE) {
      return;
    }
    if (!this.matches) {
      return;
    }
    const allEffective = _.every(this.matches, mdoc => DI.models.Match.isEffectiveStatus(mdoc.status));
    const newStatus = allEffective ? Submission.STATUS_EFFECTIVE : Submission.STATUS_RUNNING;
    this.status = newStatus;
  };

  SubmissionSchema.statics.updateSubmissionStatusAsync = async function (sdocid) {
    const sdoc = await Submission.getSubmissionObjectByIdAsync(sdocid);
    sdoc.updateStatus();
    await sdoc.save();
  };

  /**
   * Get the submission object by userId
   *
   * @return {Submission} Mongoose submission object
   */
  SubmissionSchema.statics.getSubmissionObjectByIdAsync = async function (id, projection = {}, throwWhenNotFound = true) {
    if (!objectId.isValid(id)) {
      if (throwWhenNotFound) {
        throw new errors.UserError('Submission not found');
      } else {
        return null;
      }
    }
    const s = await Submission.findOne({ _id: id }, projection);
    if (s === null && throwWhenNotFound) {
      throw new errors.UserError('Submission not found');
    }
    return s;
  };

  /**
   * Get all submissions
   */
  SubmissionSchema.statics.getAllSubmissionsCursor = function () {
    return Submission
      .find({})
      .sort({ _id: -1 });
  };

  /**
   * Get all submissions of a user
   */
  SubmissionSchema.statics.getUserSubmissionsCursor = function (uid) {
    return Submission
      .find({ user: uid })
      .sort({ _id: -1 });
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
  SubmissionSchema.statics.isUserAllowedToSubmitAsync = async function (uid) {
    const udoc = await DI.models.User.getUserObjectByIdAsync(uid);

    // Global submission lock?
    const lockdoc = await DI.models.Sys.getAsync('lock_submission', false);
    if (lockdoc && !udoc.hasPermission(permissions.BYPASS_SUBMISSION_LOCK)) {
      const reason = await DI.models.Sys.getAsync('lock_submission_reason', 'Unknown');
      return [Submission.HOT_STATUS_GLOBAL_LIMIT, reason];
    }

    // Submission quota limit?
    const usedTime = await Submission.getUsedSubmissionQuotaAsync(uid);
    if (usedTime > DI.config.compile.limits.maxExecQuota && !udoc.hasPermission(permissions.BYPASS_SUBMISSION_QUOTA)) {
      return [Submission.HOT_STATUS_QUOTA_LIMIT, usedTime];
    }

    // No last submission?
    const sdocs = await Submission.getUserSubmissionsCursor(uid).limit(1).exec();
    if (sdocs.length === 0) {
      return [Submission.HOT_STATUS_COLD];
    }

    // Last submission is CE?
    const last = sdocs[0];
    if (last.status === Submission.STATUS_COMPILE_ERROR) {
      return [Submission.HOT_STATUS_COLD];
    }

    let limit;

    // Last submission is running?
    if (last.status === Submission.STATUS_PENDING
      || last.status === Submission.STATUS_COMPILING
      || last.status === Submission.STATUS_RUNNING) {
      return [Submission.HOT_STATUS_SUBMISSION_LIMIT];
    }

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
   * Submit new code and create tasks
   *
   * @return {Submission}
   */
  SubmissionSchema.statics.createSubmissionAsync = async function (uid, code, compiler) {
    const [hotStatus] = await Submission.isUserAllowedToSubmitAsync(uid);
    if (hotStatus !== Submission.HOT_STATUS_COLD) {
      throw new errors.UserError('You are not allowed to submit new code currently.');
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
    });
    await Submission._compileForMatchAsync(sdoc);
    return sdoc;
  };

  /**
   * Recompile a submission
   */
  SubmissionSchema.statics.recompileAsync = async function (sid) {
    const sdoc = await Submission.getSubmissionObjectByIdAsync(sid);
    const csdocs = await Submission.find(
      {
        status: Submission.STATUS_COMPILING,
        _id: { $lte: objectId.fromDatetime(sdoc._id.getTimestamp()) },
      },
      { _id: 1 }
    );
    if (csdocs.length !== 0) {
      const csids = _.map(csdocs, csdoc => csdoc._id.toString());
      throw new Error(`Those submissions should be recompiled first: ${csids.join(', ')}`);
    }
    sdoc.text = '';
    sdoc.taskToken = null;
    sdoc.matches = null;
    sdoc.rejudge = true;
    await Submission._compileForMatchAsync(sdoc);
    return sdoc;
  };

  /**
   * Reset status of a submission and push it to the task queue
   *
   * @param  {MongoId|Submission} sidOrSubmission Submission id or Submission object
   * @return {Submission} The new submission object
   */
  SubmissionSchema.statics._compileForMatchAsync = async function (sdoc) {
    if (sdoc.taskToken) {
      const error = new Error('_compileForMatchAsync: Expect taskToken is undefined');
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
  SubmissionSchema.statics.getLastSubmissionsByUserAsync = async function (onlyEffective = true, maxDatetime = null) {
    const matchExp = {};
    if (onlyEffective) {
      matchExp.status = Submission.STATUS_EFFECTIVE;
    } else {
      matchExp.status = { $in: [ Submission.STATUS_RUNNING, Submission.STATUS_EFFECTIVE ] };
    }
    if (maxDatetime) {
      matchExp._id = { $lte: objectId.fromDatetime(maxDatetime) };
    }
    return await Submission.aggregate([
      { $match: matchExp },
      { $sort: { _id: -1 } },
      { $project: { user: 1, createdAt : 1, status: 1 } },
      { $group: { _id: '$user', sdocid: { $first: '$_id' } } },
    ]).allowDiskUse(true).exec();
  };

  SubmissionSchema.statics.shrink = async function () {
    DI.logger.info('Collecting last submissions...');
    const lsdocs = await DI.models.Submission.getLastSubmissionsByUserAsync();
    const sdocWhitelist = {};
    lsdocs.forEach(lsdoc => sdocWhitelist[lsdoc.sdocid.toString()] = true);

    const fsFiles = DI.mongodbConnection.collection('fs.files');
    const fsChunks = DI.mongodbConnection.collection('fs.chunks');

    let shrinked = 0;
    const n = await DI.models.Submission.count({});
    const sdocs = await DI.models.Submission.find({}, { status: 1, matchLogCleared: 1 }).sort({ _id: 1 }).exec();
    for (const sdoc of sdocs) {
      if (sdoc.matchLogCleared === true) {
        DI.logger.info('[%d / %d] Ignored processed submission %s', ++shrinked, n, sdoc._id);
      } else if (sdoc.status !== Submission.STATUS_EFFECTIVE) {
        DI.logger.info('[%d / %d] Ignored non-effective submission %s', ++shrinked, n, sdoc._id);
      } else if (sdocWhitelist[sdoc._id.toString()]) {
        DI.logger.info('[%d / %d] Ignored last submission %s', ++shrinked, n, sdoc._id);
      } else {
        DI.logger.warn('[%d / %d] Shrinking submission %s...', ++shrinked, n, sdoc._id);
        const mdocCursor = DI.models.Match.find({ u1Submission: sdoc._id }, { 'rounds.logBlob': 1 }).sort({ _id: 1 }).cursor();
        for (let mdoc = await mdocCursor.next(); mdoc !== null; mdoc = await mdocCursor.next()) {
          if (mdoc.rounds) {
            const filesToRemove = [];
            for (let round of mdoc.rounds) {
              if (round.logBlob) {
                filesToRemove.push(round.logBlob);
                round.logBlob = null;
              }
            }
            try {
              await fsFiles.remove({ _id: { $in: filesToRemove } });
              await fsChunks.remove({ files_id: { $in: filesToRemove } });
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
   * Mark a submission as compiling and return the submission if the given taskToken
   * matches the submission
   *
   * @param  {MongoId} sid
   * @param  {String} taskToken
   * @return {Submission}
   */
  SubmissionSchema.statics.judgeStartCompileAsync = async function (sid, taskToken) {
    const sdoc = await Submission.getSubmissionObjectByIdAsync(sid);
    if (sdoc.taskToken !== taskToken) {
      throw new errors.UserError('judgeStartCompileAsync: Task token does not match');
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
  SubmissionSchema.statics.judgeSetSystemErrorAsync = async function (sid, taskToken, text) {
    const sdoc = await Submission.getSubmissionObjectByIdAsync(sid);
    if (sdoc.taskToken !== taskToken) {
      throw new errors.UserError('judgeSetSystemErrorAsync: Task token does not match');
    }
    sdoc.text = text;
    sdoc.status = Submission.STATUS_SYSTEM_ERROR;
    sdoc.taskToken = null;
    await sdoc.save();
    return sdoc;
  };

  /**
   * Mark a submission as Compile Error or Running and return the submission if the
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
  SubmissionSchema.statics.judgeCompleteCompileAsync = async function (sid, taskToken, success, text, exeBlobId = null) {
    if (!success && exeBlobId !== null) {
      throw new Error('judgeCompleteCompileAsync: No executable should be supplied');
    }
    const sdoc = await Submission.getSubmissionObjectByIdAsync(sid);
    if (sdoc.taskToken !== taskToken) {
      throw new errors.UserError('judgeCompleteCompileAsync: Task token does not match');
    }
    sdoc.text = text;
    sdoc.status = success ? Submission.STATUS_RUNNING : Submission.STATUS_COMPILE_ERROR;
    if (success && exeBlobId !== null) {
      sdoc.exeBlob = exeBlobId;
    }
    await sdoc.save();
    if (success) {
      const mdocs = await Submission._createMatchAsync(sdoc);
      sdoc.matches = _.map(mdocs, mdoc => ({
        _id: mdoc._id,
        status: mdoc.status,
        usedTime: 0,
      }));
      await sdoc.save();
    }
    return sdoc;
  };

  /**
   * Create related matches for specified submission
   */
  SubmissionSchema.statics._createMatchAsync = async function (sdoc) {
    const lsdocs = await Submission.getLastSubmissionsByUserAsync(false, sdoc._id.getTimestamp());
    const mdocs = await DI.models.Match.addMatchesForSubmissionAsync(
      sdoc._id,
      sdoc.user,
      _.filter(lsdocs, lsdoc => !lsdoc._id.equals(sdoc.user))
    );
    if (mdocs.length === 0) {
      // no matches are added, mark sdoc as effective
      sdoc.status = Submission.STATUS_EFFECTIVE;
      await sdoc.save();
    }
    return mdocs;
  };

  /**
   * Update the status of a smdoc according to the status of mdoc
   *
   * @param  {ObjectId} mdocid
   */
  SubmissionSchema.statics.updateSubmissionMatchAsync = async function (mdocid) {
    const mdoc = await DI.models.Match.getMatchObjectByIdAsync(mdocid);
    const sdoc = await Submission.getSubmissionObjectByIdAsync(mdoc.u1Submission);
    if (!sdoc.matches) {
      // Only compiled submission contains `matches`
      return;
    }
    const smdoc = sdoc.matches.find(smdoc => smdoc._id.equals(mdocid));
    if (smdoc === undefined) {
      return;
    }
    smdoc.status = mdoc.status;
    smdoc.usedTime = mdoc.usedTime;
    await sdoc.save();
  };

  /**
   * Get all pending, running, compiling or system_error matches
   */
  SubmissionSchema.statics.getPendingSubmissionsCursor = function () {
    return Submission
      .find({
        status: { $in: [Submission.STATUS_PENDING, Submission.STATUS_RUNNING, Submission.STATUS_COMPILING, Submission.STATUS_SYSTEM_ERROR] },
      })
      .sort({ _id: -1 });
  };

  /**
   * Get used submission quota of a user
   *
   * @param  {ObjectId} uid
   * @return {Number}
   */
  SubmissionSchema.statics.getUsedSubmissionQuotaAsync = async function (uid) {
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
  SubmissionSchema.statics.incrUsedSubmissionQuotaAsync = async function (uid, usedTime) {
    return await DI.redis
      .multi()
      .incrby(`used_quota:${uid}`, usedTime)
      .expireat(`used_quota:${uid}`, moment().add(1, 'd').startOf('day').unix())
      .execAsync();
  };

  SubmissionSchema.index({ user: 1, _id: -1 });
  SubmissionSchema.index({ status: 1, _id: -1 });

  Submission = mongoose.model('Submission', SubmissionSchema);
  return Submission;

};
