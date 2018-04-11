import * as web from 'express-decorators';
import utils from 'libs/utils';
import permissions from 'libs/permissions';
import changelog from 'libs/changelog';

@web.controller('/')
export default class Handler {

  @web.use()
  async navType(req, res, next) {
    res.locals.nav_type = 'scoreboard';
    next();
  }

  @web.get('/')
  @web.middleware(utils.checkPermission(permissions.VIEW_SCOREBOARD))
  async getScoreboardAction(req, res) {
    const [udocs, cacheAt] = await DI.models.Scoreboard.calculate();
    res.render('scoreboard', {
      page_title: 'Scoreboard',
      udocs,
      cacheAt,
      changelog: changelog.newest(),
    });
  }
}
