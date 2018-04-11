import * as web from 'express-decorators';
import utils from 'libs/utils';
import sanitizers from 'libs/sanitizers';
import permissions from 'libs/permissions';
import changelog from '../libs/changelog';

@web.controller('/help')
export default class Handler {

  @web.use()
  async navType(req, res, next) {
    res.locals.nav_type = 'help';
    next();
  }

  @web.get('/rules')
  async rules(req, res) {
    res.render('help_rules', {
      page_title: 'Rules',
    });
  }

  @web.get('/about')
  async about(req, res) {
    res.render('help_about', {
      page_title: 'About',
    });
  }

  @web.get('/changelog')
  async changelog(req, res) {
    res.render('help_changelog', {
      page_title: 'Change Log',
      changelogs: changelog.all(),
    });
  }

}
