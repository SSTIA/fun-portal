import * as web from 'express-decorators';
import _ from 'lodash';
import utils from 'libs/utils';

@web.controller('/user')
export default class Handler {

  @web.use()
  async navType(req, res, next) {
    res.locals.nav_type = 'user';
    next();
  }

  @web.get('/profile')
  @web.middleware(utils.checkLogin())
  async getUserProfileAction(req, res) {
    const udoc = await DI.models.User.getUserObjectByIdAsync(req.session.user._id);
    res.render('user_profile', {
      page_title: 'My Profile',
      udoc,
    });
  }

  @web.post('/profile')
  @web.middleware(utils.sanitizeBody({
    realName: utils.checkNonEmpty(),
    displayName: utils.checkNonEmpty(),
    teacher: utils.checkNonEmpty(),
  }))
  @web.middleware(utils.checkLogin())
  async postUserProfileAction(req, res) {
    const udoc = await DI.models.User.getUserObjectByIdAsync(req.session.user._id);
    _.assign(udoc.profile, req.data);
    udoc.profile.initial = false;
    await udoc.save();
    req.session.user = udoc;
    res.redirect(utils.url('/user/profile'));
  }

}
