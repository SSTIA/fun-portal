import * as web from 'express-decorators';
import _ from 'lodash';
import utils from 'libs/utils';
import sanitizers from 'libs/sanitizers';
import permissions from 'libs/permissions';

@web.controller('/manage')
export default class Handler {

  @web.use()
  async navType(req, res, next) {
    res.locals.nav_type = 'user';
    next();
  }

  @web.get('/matches')
  @web.middleware(utils.checkPermission(permissions.VIEW_MANAGE_PORTAL))
  async getMatches(req, res) {
    res.render('manage_matches', {
      page_title: 'Matches',
      pending_mdocs: await DI.models.Match.getPendingMatchesAsync(),
    });
  }

  @web.post('/matches/pending')
  @web.middleware(utils.checkPermission(permissions.VIEW_MANAGE_PORTAL))
  async postRejudgePendingMatches(req, res) {
    const mdocs = await DI.models.Match.getPendingMatchesAsync();
    // rejudge from distant time
    mdocs.reverse();
    for (const mdoc of mdocs) {
      await DI.models.Match.rejudgeMatchAsync(mdoc._id);
    }
    res.redirect(utils.url('/manage/matches'));
  }

}
