import _ from 'lodash';
import mongoose from 'mongoose';

export default () => {
  const LeaderPairSchema = new mongoose.Schema({
    u1u2: Buffer,
    u1Submission: mongoose.Schema.Types.ObjectId,
    u1: mongoose.Schema.Types.ObjectId,
    u2: mongoose.Schema.Types.ObjectId,
    status: String,
  });

  // LeaderPair Model
  let LeaderPair;

  // Rebuild all pair records
  LeaderPairSchema.statics.rebuildAsync = async function () {
    DI.logger.debug('LeaderPair.rebuildAsync: removing all records...');
    await LeaderPair.remove({});
    DI.logger.debug('LeaderPair.rebuildAsync: fetching last submissions...');
    const lsdocs = await DI.models.Submission.getLastSubmissionsByUserAsync();
    const mdocCursor = DI.models.Match.getPairwiseMatchesCursor(_.map(lsdocs, 'sdocid'));
    const mdocCount = await mdocCursor.query.model.count(mdocCursor.query._conditions);
    for (let mdoc = await mdocCursor.next(), i = 1; mdoc !== null; mdoc = await mdocCursor.next(), i++) {
      DI.logger.debug('LeaderPair.rebuildAsync: updating %d/%d...', i, mdocCount);
      await LeaderPair.updatePairByMatchAsync(mdoc);
    }
    DI.logger.debug('LeaderPair.rebuildAsync: done');
    return true;
  };

  /**
   * Update a leader pair
   *
   * @param  {ObjectId} u1id
   * @param  {ObjectId} u2id
   * @param  {ObjectId} u1sid u1 submission id
   * @param  {String} status u1 submission status
   */
  LeaderPairSchema.statics.updatePairAsync = async function (u1id, u2id, u1sid, u1status) {
    const u1buf = new Buffer(u1id.toString(), 'hex');
    const u2buf = new Buffer(u2id.toString(), 'hex');
    const u1u2 = Buffer.concat([u1buf, u2buf]);
    await LeaderPair.update(
      { u1u2, u1Submission: { $lte: u1sid } },
      { $set: { u1Submission: u1sid, u1: u1id, u2: u2id, status: u1status } },
      { upsert: true, runValidators: true }
    ).exec();
    return true;
  };
  LeaderPairSchema.statics.updatePairByMatchAsync = function (mdoc) {
    return LeaderPair.updatePairAsync(mdoc.u1, mdoc.u2, mdoc.u1Submission, mdoc.status);
  };

  /**
   * Get all leader pairs
   */
  LeaderPairSchema.statics.getAllAsync = async function () {
    const lpdocs = await LeaderPair
      .find({}, { _id: 0, u1: 1, u2: 1, status: 1 })
      .sort({ u1Submission: -1 })
      .exec();
    return lpdocs;
  };

  DI.eventBus.on('match.status:updated', async mdoc => {
    if (!DI.models.Match.isEffectiveStatus(mdoc.status)) {
      return;
    }
    try {
      await LeaderPair.updatePairByMatchAsync(mdoc);
    } catch (err) {
      DI.logger.error(err.stack);
    }
  });

  LeaderPairSchema.index({ u1u2: 1 }, { unique: true });
  LeaderPairSchema.index({ u1u2: 1, u1Submission: 1 });
  LeaderPairSchema.index({ u1Submission: -1 });

  LeaderPair = mongoose.model('LeaderPair', LeaderPairSchema);
  return LeaderPair;

};
