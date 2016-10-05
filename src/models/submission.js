import mongoose from 'mongoose';
import errors from 'libs/errors';

export default () => {
  const SubmissionSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'user' },
    code: String,
    status: String,
    text: String,
  }, {
    timestamps: true,
  });

  SubmissionSchema.statics.LIMIT_SIZE_CODE = 1 * 1024 * 1024;
  SubmissionSchema.statics.LIMIT_SIZE_EXECUTABLE = 5 * 1024 * 1024;
  SubmissionSchema.statics.LIMIT_MIN_INTERVAL = 24 * 60 * 60 * 1000;

  SubmissionSchema.statics.STATUS_PENDING = 'pending';
  SubmissionSchema.statics.STATUS_RUNNING = 'running';
  SubmissionSchema.statics.STATUS_COMPILE_ERROR = 'ce';
  SubmissionSchema.statics.STATUS_EFFECTIVE = 'effective';

  SubmissionSchema.statics.STATUS_TEXT = {
    'pending': 'Pending',
    'running': 'Running',
    'ce': 'Compile Error',
    'effective': 'Effective',
  };

  /**
   * Get all submissions of a user
   * @return {[Submission]}
   */
  SubmissionSchema.statics.getUserSubmissions = async function (uid, limit = null) {
    let query = this
      .find({ user: uid })
      .sort({ createdAt: -1 });
    if (limit) {
      query = query.limit(limit);
    }
    const submissions = await query.exec();
    return submissions;
  };

  /**
   * Check whether a user is allowed to submit new code
   * @return {Boolean}
   */
  SubmissionSchema.statics.isUserAllowedToSubmit = async function (uid) {
    const submissions = await this.getUserSubmissions(uid, 1);
    if (submissions.length === 0) {
      return true;
    }
    const last = submissions[0];
    if (last.status === this.STATUS_COMPILE_ERROR) {
      return true;
    }
    if (Date.now() - last.createdAt.getTime() > this.LIMIT_MIN_INTERVAL) {
      return true;
    }
    return false;
  };

  /**
   * Submit new code
   * @return {Submission}
   */
  SubmissionSchema.statics.createSubmission = async function (uid, code) {
    if (!this.isUserAllowedToSubmit(uid)) {
      throw new errors.UserError('You are not allowed to submit new code currently');
    }
    if (code.length > this.LIMIT_SIZE_CODE) {
      throw new errors.ValidationError('Your source code is too large.');
    }
    const newSubmission = new this({
      user: uid,
      code,
      status: this.STATUS_PENDING,
      text: '',
    });
    await newSubmission.save();
    return newSubmission;
  };

  SubmissionSchema.index({ user: 1, createdAt: -1 });

  return mongoose.model('Submission', SubmissionSchema);
};
