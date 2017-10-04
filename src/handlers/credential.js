import * as web from 'express-decorators';
import utils from 'libs/utils';
import sanitizers from 'libs/sanitizers';
import errors from 'libs/errors';
import credential from 'libs/credential';
import permissions from 'libs/permissions';

const DIRECTORY_COOKIE = 'iPlanetDirectoryPro';

@web.controller('/')
export default class Handler {

  @web.get('/login')
  async getLoginAction(req, res) {
    const errors = {};
    const directory = req.cookies[DIRECTORY_COOKIE];
    if (req.query.success !== undefined && directory !== undefined) {
      try {
        const user = await DI.models.User.authenticateSsoAsync(directory);
        await credential.setCredential(req, user._id);
        if (user.profile.initial) {
          res.redirect(utils.url('/user/profile'));
        } else {
          res.redirect(utils.url('/'));
        }
        return;
      } catch (e) {
        errors.error = e.message;
      }
    }
    if (req.query.failure !== undefined) {
      errors.error = 'Unable to login using Tongji account. Incorrect student ID or password.';
    }
    res.render('login', {
      page_title: 'Sign In',
      ...errors,
    });
  }

  // for debug purpose only, only available when
  // ssoUrl === false
  @web.post('/login')
  @web.middleware(utils.sanitizeBody({
    studentId: sanitizers.nonEmptyString(),
  }))
  async postLoginAction(req, res) {
    if (DI.config.ssoUrl !== false) {
      throw new errors.PermissionError();
    }
    const user = await DI.models.User.authenticateFakeSsoAsync(req.data.studentId);
    await credential.setCredential(req, user._id);
    res.redirect(utils.url('/'));
  }

  @web.post('/logout')
  @web.middleware(utils.checkPermission(permissions.PROFILE))
  async postLogoutAction(req, res) {
    req.session.destroy();
    res.clearCookie(DIRECTORY_COOKIE, { domain: '.tongji.edu.cn' });
    res.redirect(utils.url('/'));
  }

}
