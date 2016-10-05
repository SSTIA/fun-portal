import mongoose from 'mongoose';

export default () => {
  const MatchSchema = new mongoose.Schema({
    status: Number,
    u1: { type: mongoose.Schema.Types.ObjectId, ref: 'user' },
    u2: { type: mongoose.Schema.Types.ObjectId, ref: 'user' },
    u1Submission: { type: mongoose.Schema.Types.ObjectId, ref: 'submission' },
    u2Submission: { type: mongoose.Schema.Types.ObjectId, ref: 'submission' },
    u1Score: Number,  // only exists after match is completed
    n2Score: Number,  // only exists after match is completed
    rounds: [{
      _id: mongoose.Schema.Types.ObjectId,
      status: Number,
      u1Black: Boolean,
      u2Black: Boolean, // !u1Black
      beginJudgeAt: Date,
      endJudgeAt: Date,
      logs: String,
    }],
  }, {
    timestamps: true,
  });

  // For both match and round
  MatchSchema.statics.STATUS_PENDING = 0;
  MatchSchema.statics.STATUS_RUNNING = 1;
  MatchSchema.statics.STATUS_U1WIN = 2;
  MatchSchema.statics.STATUS_U2WIN = 3;
  MatchSchema.statics.STATUS_DRAW = 4;

  return mongoose.model('Match', MatchSchema);
};
