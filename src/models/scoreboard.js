import _ from 'lodash';
import utils from 'libs/utils';

export default () => {
  const ScoreboardModel = {};

  let cache = {
    available: false,
    dirty: true,
  };

  async function flushCache() {
    if (!cache.dirty) {
      cache.at = new Date();
      return;
    }

    const endProfile = utils.profile('Scoreboard.flushCache');

    const udocs = await DI.models.User.getEffectiveUsersAsync();

    const lsdocs = await DI.models.Submission.getLastSubmissionsByUserAsync();
    await DI.models.Submission.populate(lsdocs, {
      path: 'sdocid',
      select: { code: 0, matches: 0 },
    });

    // All effective and deduplicated matches related to those submissions
    //const _mdocs = await DI.models.Match.getPairwiseMatchesAsync(_.map(lsdocs, 'sdocid._id'));
    //const mdocs = _.uniqBy(_mdocs, mdoc => _.orderBy([mdoc.u1, mdoc.u2], '_id').join('_'));
    const _mdocs = await DI.models.LeaderPair.getAllAsync();
    const mdocs = _.uniqBy(_mdocs, mdoc => [mdoc.u1.toString(), mdoc.u2.toString()].sort().join('_'));

    cache.udocs = udocs;
    cache.lsdocs = lsdocs;
    cache.mdocs = mdocs;
    cache.available = true;
    cache.at = new Date();
    cache.dirty = false;

    endProfile();
  }

  setInterval(flushCache, DI.config.scoreboard.cacheDuration).unref();

  DI.eventBus.on('system.started', () => flushCache());

  DI.eventBus.on('submission.status:updated', () => {
    cache.dirty = true;
  });

  /**
   * Calculate the latest scoreboard
   *
   * @return {[rows, cacheAt]}
   */
  ScoreboardModel.calculate = async function () {
    if (!cache.available) {
      return [false];
    }
    let { lsdocs, mdocs } = cache;

    // Badges
    const badgesByStudentId = _.keyBy(await DI.models.Badge.getBadgesAsync(), 'studentId');

    // Results
    const _rdocs = _.map(await DI.models.User.getAllUsersAsync(), udoc => ({
      udoc,
      badge: badgesByStudentId[_.get(udoc, 'profile.studentId')],
      rank: 0,
      score: 0,
      win: 0,
      lose: 0,
      draw: 0,
      lsdoc: null,
    }));
    const uid2rdocidx = _.invertBy(_rdocs, 'udoc._id');

    // Fill sdoc for results
    lsdocs.forEach(lsdoc => _rdocs[uid2rdocidx[lsdoc._id]].lsdoc = lsdoc.sdocid);

    // Fill score, win, lose, draw
    mdocs.forEach(mdoc => {
      if (mdoc.status === DI.models.Match.STATUS_U1WIN) {
        _rdocs[uid2rdocidx[mdoc.u1]].score += 3;
        _rdocs[uid2rdocidx[mdoc.u1]].win += 1;
        _rdocs[uid2rdocidx[mdoc.u2]].lose += 1;
      } else if (mdoc.status === DI.models.Match.STATUS_U2WIN) {
        _rdocs[uid2rdocidx[mdoc.u2]].score += 3;
        _rdocs[uid2rdocidx[mdoc.u2]].win += 1;
        _rdocs[uid2rdocidx[mdoc.u1]].lose += 1;
      } else {
        _rdocs[uid2rdocidx[mdoc.u1]].score += 1;
        _rdocs[uid2rdocidx[mdoc.u1]].draw += 1;
        _rdocs[uid2rdocidx[mdoc.u2]].score += 1;
        _rdocs[uid2rdocidx[mdoc.u2]].draw += 1;
      }
    });

    // Order and fill rank
    const rdocs = _.orderBy(
      _rdocs,
      ['score', 'win', 'draw', 'lose', 'sdoc._id', 'udoc._id'],
      ['desc',  'desc','desc', 'asc',  'asc',      'asc']
    );
    let lastRank = 0, lastScore = -1;
    rdocs.forEach((rdoc, idx) => {
      if (rdoc.score !== lastScore) {
        rdoc.rank = (idx + 1);
        lastRank = rdoc.rank;
        lastScore = rdoc.score;
      } else {
        rdoc.rank = lastRank;
      }
    });

    return [rdocs, cache.at];
  };

  return {
    modelName: 'Scoreboard',
    ...ScoreboardModel,
  };
};
