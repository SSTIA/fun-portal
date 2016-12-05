import mongoose from 'mongoose';
import fsp from 'fs-promise';

export default () => {
  const BadgeSchema = new mongoose.Schema({
    studentId: String,
    text: String,
    style: String,
  });

  // Badge Model
  let Badge;

  /**
   * Remove all badges
   */
  BadgeSchema.statics.clearAsync = async function () {
    await Badge.remove({});
  };

  /**
   * Import badges from file
   */
  BadgeSchema.statics.importBadgeAsync = async function (rows) {
    await Badge.clearAsync();
    for (let row of rows) {
      const badge = new Badge(row);
      await badge.save();
    }
    return rows.length;
  };

  BadgeSchema.statics.importBadgeFromFileAsync = async function (filePath) {
    const content = await fsp.readFile(filePath, 'utf8');
    const rows = JSON.parse(content);
    return await Badge.importBadgeAsync(rows);
  };

  /**
   * Get all badges
   * @return {Badge}
   */
  BadgeSchema.statics.getBadgesAsync = async function () {
    const badges = await Badge.find({});
    return badges;
  };

  Badge = mongoose.model('Badge', BadgeSchema);
  return Badge;

};
