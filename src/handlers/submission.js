import * as web from 'express-decorators';
import utils from 'libs/utils';
import errors from 'libs/errors';

@web.controller('/submission')
export default class Handler {

  @web.use()
  async navType(req, res, next) {
    res.locals.nav_type = 'submission';
    next();
  }

  @web.get('/')
  @web.middleware(utils.checkLogin())
  async getSubmissionAction(req, res) {
    const sdocs = await DI.models.Submission.getUserSubmissions(req.session.user._id);
    res.render('submission_main', {
      page_title: 'My Submissions',
      sdocs,
    });
  }

  @web.get('/create')
  @web.middleware(utils.checkProfile())
  @web.middleware(utils.checkLogin())
  async getSubmissionCreateAction(req, res) {
    res.render('submission_create', {
      page_title: 'Submit My Brain',
      canSubmit: await DI.models.Submission.isUserAllowedToSubmit(req.session.user._id),
    });
  }

  @web.post('/create')
  @web.middleware(utils.sanitizeBody({
    code: utils.checkNonEmpty(),
  }))
  @web.middleware(utils.checkProfile())
  @web.middleware(utils.checkLogin())
  async postSubmissionCreateAction(req, res) {
    await DI.models.Submission.createSubmission(
      req.session.user._id,
      req.data.code
    );
    res.redirect(utils.url('/submission'));
  }


  @web.get('/all')
  @web.middleware(utils.checkLogin())
  async getAllSubmissionAction(req, res) {

  }

}
