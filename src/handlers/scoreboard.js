import * as web from 'express-decorators';
import utils from 'libs/utils';

@web.controller('/')
export default class Handler {

  @web.use()
  async navType(req, res, next) {
    res.locals.nav_type = 'scoreboard';
    next();
  }

  @web.get('/')
  @web.middleware(utils.checkProfile())
  async getScoreboardAction(req, res) {
    res.render('home', {
      page_title: 'Scoreboard',
    });
  }

}
