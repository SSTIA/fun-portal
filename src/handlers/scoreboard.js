import * as web from 'express-decorators';
import utils from 'libs/utils';
import permissions from 'libs/permissions';

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
    const sbdoc = await DI.models.Scoreboard.calculate();
    res.render('scoreboard', {
      page_title: 'Scoreboard',
      sbdoc,
    });
  }
}
