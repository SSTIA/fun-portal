import _ from 'lodash';

export default () => {
  const ScoreboardModel = {};

  let cache = {};
  function invalidateCache() {
    cache = {};
  }

  DI.eventBus.on('submission.status:updated', invalidateCache);

  /**
   * Calculate the latest scoreboard
   */
  ScoreboardModel.calculate = async function () {
    let { lsdocs, mdocs } = cache;

    if (!lsdocs) {
      // Latest submissions grouped by user
      lsdocs = await DI.models.Submission.getLastSubmissionsByUserAsync();
      await DI.models.Submission.populate(lsdocs, {
        path: 'sdocid',
        select: { code: 0, matches: 0 },
      });
      cache.lsdocs = lsdocs;
    }

    if (!mdocs) {
      // All effective and deduplicated matches related to those submissions
      const _mdocs = await DI.models.Match.getPairwiseMatchesAsync(_.map(lsdocs, 'sdocid._id'));
      mdocs = _.uniqBy(_mdocs, mdoc => _.orderBy([mdoc.u1, mdoc.u2], '_id').join('_'));
      cache.mdocs = mdocs;
    }

    // Results
    const _rdocs = _.map(await DI.models.User.getAllUsersAsync(), udoc => ({
      udoc,
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

    return rdocs;
  };

  return {
    modelName: 'Scoreboard',
    ...ScoreboardModel,
  };
};
