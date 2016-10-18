import * as web from 'express-decorators';
import multer from 'multer';
import fsp from 'fs-promise';
import utils from 'libs/utils';
import errors from 'libs/errors';

// file limit is infinity
const logUpload = multer({
  storage: multer.diskStorage({}),
});

@web.controller('/match')
export default class Handler {

  @web.get('/:id')
  @web.middleware(utils.checkLogin())
  async getMatchDetailAction(req, res) {
    const mdoc = await DI.models.Match.getMatchObjectByIdAsync(req.params.id);
    await mdoc.populate('u1 u2 u1Submission u2Submission').execPopulate();
    res.render('match_detail', {
      page_title: 'Match Detail',
      mdoc,
    });
  }

  @web.post('/api/roundBegin')
  @web.middleware(utils.sanitizeBody({
    mid: utils.checkNonEmptyString(),
    rid: utils.checkNonEmptyString(),
  }))
  @web.middleware(utils.checkAPI())
  async apiRoundBegin(req, res) {
    const mdoc = await DI.models.Match.judgeStartRoundAsync(
      req.data.mid,
      req.data.rid
    );
    res.json(mdoc);
  }

  @web.post('/api/roundError')
  @web.middleware(utils.sanitizeBody({
    mid: utils.checkNonEmptyString(),
    rid: utils.checkNonEmptyString(),
    text: utils.checkNonEmptyString(),
  }))
  @web.middleware(utils.checkAPI())
  async apiRoundError(req, res) {
    const mdoc = await DI.models.Match.judgeCompleteRoundAsync(
      req.data.mid,
      req.data.rid,
      DI.models.Match.STATUS_SYSTEM_ERROR,
      null,
      req.data.text
    );
    res.json(mdoc);
  }

  @web.post('/api/roundComplete')
  @web.middleware(utils.sanitizeBody({
    mid: utils.checkNonEmptyString(),
    rid: utils.checkNonEmptyString(),
    exitCode: utils.checkInt(),
  }))
  @web.middleware(logUpload.single('log'))
  @web.middleware(utils.checkAPI())
  async apiRoundComplete(req, res) {
    if (!req.file) {
      throw new errors.UserError('Expect logs');
    }
    const file = await DI.gridfs.putBlobAsync(fsp.createReadStream(req.file.path), {
      contentType: 'text/plain',
      metadata: {
        type: 'match.log',
        match: req.data.mid,
        round: req.data.rid,
      },
    });
    try {
      await fsp.remove(req.file.path);
    } catch (err) {
      DI.logger.error(err);
    }
    const mdoc = await DI.models.Match.judgeCompleteRoundAsync(
      req.data.mid,
      req.data.rid,
      DI.models.Match.getStatusFromJudgeExitCode(req.data.exitCode),
      file._id
    );
    res.json(mdoc);
  }

}
