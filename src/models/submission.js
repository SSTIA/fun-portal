import _ from 'lodash';
import uuid from 'uuid';
import mongoose from 'mongoose';
import async from 'async';
import objectId from 'libs/objectId';
import errors from 'libs/errors';

export default () => {
  const SubmissionSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    version: Number,  // nth submission of this user
    code: String,
    exeBlob: mongoose.Schema.Types.ObjectId,  // grid fs
    status: String,
    text: String,
    taskToken: String,    // A unique token for each task, so that duplicate tasks
                          // won't be judged multiple times
    matches: [{
      _id: mongoose.Schema.Types.ObjectId,
      status: String,
    }],
  }, {
    timestamps: true,
  });

  // Submission Model
  let Submission;

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

  async function updateSingleSubmissionStatus(submissionId) {
    try {
      const submission = await Submission.getSubmissionObjectByIdAsync(submissionId);
      submission.updateSubmissionStatus();
      await submission.save();
    } catch (ignored) {
      // ignore errors
    }
  }

  /**
   * Single worker queue to deal with submission status updates to avoid race conditions
   */
  const submissionStatusUpdateQueue = async.queue((submissionId, callback) => {
    updateSingleSubmissionStatus(submissionId).then(() => callback());
  }, 1);

  /**
   * Update the submission status when match status is updated
   */
  SubmissionSchema.pre('save', function (next) {
    const modifiedPaths = this.modifiedPaths();
    if (_.some(modifiedPaths, path => path.match(/^matches\.\d+\.status$/))) {
      submissionStatusUpdateQueue.push(this._id);
    }
    next();
  });

  /**
   * Update the status of the submission based on status of matches.
   * Status will be changed only from `running` to `effective`, or reversed.
   */
  SubmissionSchema.methods.updateSubmissionStatus = function () {
    if (this.status !== Submission.STATUS_RUNNING && this.status !== Submission.STATUS_EFFECTIVE) {
      return;
    }
    if (!this.matches) {
      return;
    }
    const hasRunningMatch = _.some(this.matches, mdoc => DI.models.Match.isRunningStatus(mdoc.status));
    if (hasRunningMatch) {
      this.status = Submission.STATUS_RUNNING;
    } else {
      this.status = Submission.STATUS_EFFECTIVE;
    }
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
   * @return {Boolean}
   */
  SubmissionSchema.statics.isUserAllowedToSubmitAsync = async function (uid) {
    const sdocs = await Submission.getUserSubmissionsCursor(uid).limit(1).exec();
    if (sdocs.length === 0) {
      return true;
    }
    const last = sdocs[0];
    if (last.status === Submission.STATUS_COMPILE_ERROR) {
      return true;
    }
    if (Date.now() - last.createdAt.getTime() > DI.config.compile.limits.submitInterval) {
      return true;
    }
    return false;
  };

  /**
   * Submit new code and create tasks
   *
   * @return {Submission}
   */
  SubmissionSchema.statics.createSubmissionAsync = async function (uid, code) {
    if (!await Submission.isUserAllowedToSubmitAsync(uid)) {
      throw new errors.UserError('You are not allowed to submit new code currently');
    }
    if (code.length > DI.config.compile.limits.sizeOfCode) {
      throw new errors.ValidationError('Your source code is too large.');
    }
    const version = await DI.models.User.incAndGetSubmissionNumberAsync(uid);
    const sdoc = new Submission({
      user: uid,
      version,
      code,
      status: Submission.STATUS_PENDING,
      text: '',
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
      DI.logger.error(error);
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
      throw new Error('judgeStartCompileAsync: Task token does not match');
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
      throw new Error('judgeSetSystemErrorAsync: Task token does not match');
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
      throw new Error('judgeCompleteCompileAsync: Task token does not match');
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
   * Update the status of a mdoc in the submission and determine the submission status
   *
   * @param  {ObjectId} sid
   * @param  {ObjectId} mdocid
   * @param  {String} status Match Status
   */
  SubmissionSchema.statics._updateSubMatchStatusAsync = async function (sid, mdocid, status) {
    const sdoc = await Submission.getSubmissionObjectByIdAsync(sid);
    if (!sdoc.matches) {
      // Only compiled submission contains `matches`
      return;
    }
    const mdoc = sdoc.matches.find(mdoc => mdoc._id.equals(mdocid));
    mdoc.status = status;
    await sdoc.save();
  };

  /**
   * Update corresponding sub-match status when a match status is updated
   */
  DI.eventBus.on('match.statusChanged', (match) => {
    Submission._updateSubMatchStatusAsync(
      objectId.getFromIdOrDoc(match.u1Submission),
      match._id,
      match.status
    ).catch(err => DI.logger.error(err));
  });

  SubmissionSchema.index({ user: 1, _id: -1 });
  SubmissionSchema.index({ status: 1, _id: -1 });

  Submission = mongoose.model('Submission', SubmissionSchema);
  return Submission;

};
