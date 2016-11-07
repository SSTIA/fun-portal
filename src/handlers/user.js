import * as web from 'express-decorators';
import _ from 'lodash';
import utils from 'libs/utils';
import sanitizers from 'libs/sanitizers';
import permissions from 'libs/permissions';

@web.controller('/user')
export default class Handler {

  @web.use()
  async navType(req, res, next) {
    res.locals.nav_type = 'user';
    next();
  }

  @web.get('/profile')
  @web.middleware(utils.checkPermission(permissions.PROFILE))
  async getUserProfileAction(req, res) {
    const udoc = req.credential;
    res.render('user_profile', {
      page_title: 'My Profile',
      udoc,
    });
  }

  @web.post('/profile')
  @web.middleware(utils.sanitizeBody({
    realName: sanitizers.nonEmptyString(),
    displayName: sanitizers.nonEmptyString(),
    teacher: sanitizers.nonEmptyString(),
  }))
  @web.middleware(utils.checkPermission(permissions.PROFILE))
  async postUserProfileAction(req, res) {
    const udoc = req.credential;
    _.assign(udoc.profile, req.data);
    udoc.profile.initial = false;
    await udoc.save();
    res.redirect(utils.url('/user/profile'));
  }

}
