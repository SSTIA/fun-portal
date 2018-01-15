import * as web from 'express-decorators';
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

  @web.get('/test_match')
  async testMatch(req, res) {
    const u1 = await DI.models.User.getHighestPriorityAsync();
    if (u1 === null) return;
    const u2 = await DI.models.User.getBestOpponentAsync(u1, u1.match.streak >=
      0);
    if (u2 === null) return;
    await DI.models.Match.createMatchAsync(u1, u2);
    //console.log(u1, u2);
    res.send({
      u1, u2,
    });
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
      //await DI.models.Match.rejudgeMatchAsync(mdoc._id);
    }
    res.redirect(utils.url('/manage/matches'));
  }

  @web.get('/system')
  @web.middleware(utils.checkPermission(permissions.VIEW_MANAGE_PORTAL))
  async getSystemVariables(req, res) {
    res.render('manage_system', {
      page_title: 'System',
      sdocs: await DI.models.Sys.getAllAsync(),
    });
  }

  @web.post('/system')
  @web.middleware(utils.sanitizeBody({
    lock_submission: sanitizers.bool(),
    lock_submission_reason: sanitizers.string(),
  }))
  @web.middleware(utils.checkPermission(permissions.VIEW_MANAGE_PORTAL))
  async postSystemVariables(req, res) {
    if (req.data.lock_submission && req.data.lock_submission_reason === '') {
      req.data.lock_submission_reason = 'Unknown';
    }
    for (let key in req.data) {
      await DI.models.Sys.setAsync(key, req.data[key]);
    }
    res.redirect(utils.url('/manage/system'));
  }

}
