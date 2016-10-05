import * as web from 'express-decorators';
import utils from 'libs/utils';

const DIRECTORY_COOKIE = 'iPlanetDirectoryPro';

@web.controller('/')
export default class Handler {

  @web.get('/login')
  async getLoginAction(req, res) {
    const errors = {};
    const directory = req.cookies[DIRECTORY_COOKIE];
    if (directory !== undefined) {
      try {
        const user = await DI.models.User.authenticateSsoAsync(directory);
        req.session.user = user;
        res.redirect(utils.url('/'));
        return;
      } catch (e) {
        errors.error = e.message;
      }
    }
    if (req.query.failure) {
      errors.error = 'Unable to login using Tongji account. Incorrect student ID or password.';
    }
    res.render('login', {
      page_title: 'Sign In',
      ...errors,
    });
  }

  @web.post('/logout')
  @web.middleware(utils.checkLogin())
  async postLogoutAction(req, res) {
    req.session.destroy();
    res.clearCookie(DIRECTORY_COOKIE, { domain: '.tongji.edu.cn' });
    res.redirect(utils.url('/'));
  }

}
