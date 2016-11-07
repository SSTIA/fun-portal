import * as web from 'express-decorators';
import multer from 'multer';
import fsp from 'fs-promise';
import utils from 'libs/utils';
import sanitizers from 'libs/sanitizers';
import errors from 'libs/errors';
import permissions from 'libs/permissions';
import socket from 'libs/socket';

const binUpload = multer({
  storage: multer.diskStorage({}),
  limits: {
    fieldSize: Math.max(
      DI.config.compile.limits.sizeOfCode,
      DI.config.compile.limits.sizeOfBin,
      DI.config.compile.limits.sizeOfText
    ) * 2,
    fileSize: DI.config.compile.limits.sizeOfBin * 2,
  },
});

const SUBMISSIONS_PER_PAGE = 50;

@socket.enable()
@web.controller('/submission')
export default class Handler {

  @web.use()
  async navType(req, res, next) {
    res.locals.nav_type = 'submission';
    next();
  }

  @web.post('/api/compileBegin')
  @web.middleware(utils.sanitizeBody({
    id: sanitizers.nonEmptyString(),
    token: sanitizers.nonEmptyString(),
  }))
  @web.middleware(utils.checkAPI())
  async apiCompileBegin(req, res) {
    const sdoc = await DI.models.Submission.judgeStartCompileAsync(
      req.data.id,
      req.data.token
    );
    await sdoc.populate('user').execPopulate();
    res.json(sdoc);
  }

  @web.post('/api/compileError')
  @web.middleware(utils.sanitizeBody({
    id: sanitizers.nonEmptyString(),
    token: sanitizers.nonEmptyString(),
    text: sanitizers.string(),
  }))
  @web.middleware(utils.checkAPI())
  async apiCompileError(req, res) {
    const sdoc = await DI.models.Submission.judgeSetSystemErrorAsync(
      req.data.id,
      req.data.token,
      req.data.text
    );
    res.json(sdoc);
  }

  @web.post('/api/compileEnd')
  @web.middleware(utils.sanitizeBody({
    id: sanitizers.nonEmptyString(),
    token: sanitizers.nonEmptyString(),
    text: sanitizers.string(),
    success: sanitizers.bool(),
  }))
  @web.middleware(binUpload.single('binary'))
  @web.middleware(utils.checkAPI())
  async apiCompileEnd(req, res) {
    let file = null;
    if (req.data.success && req.file) {
      file = await DI.gridfs.putBlobAsync(fsp.createReadStream(req.file.path), {
        contentType: 'application/x-xz',
        metadata: {
          type: 'submission.binary',
          submission: req.data.id,
        },
      });
      try {
        await fsp.remove(req.file.path);
      } catch (err) {
        DI.logger.error(err.stack);
      }
    }
    const sdoc = await DI.models.Submission.judgeCompleteCompileAsync(
      req.data.id,
      req.data.token,
      req.data.success,
      req.data.text,
      file === null ? null : file._id
    );
    res.json(sdoc);
  }

  @web.get('/api/binary')
  @web.middleware(utils.sanitizeQuery({
    id: sanitizers.nonEmptyString(),
  }))
  @web.middleware(utils.checkAPI())
  async apiGetBinary(req, res) {
    const sdoc = await DI.models.Submission.getSubmissionObjectByIdAsync(req.data.id);
    if (!sdoc.exeBlob) {
      throw new errors.UserError('Executable file not found for the submission');
    }
    const exists = await DI.gridfs.existsAsync(sdoc.exeBlob);
    if (!exists) {
      throw new errors.UserError('Executable blob does not exist in the database for the submission');
    }
    res.setHeader('Content-disposition', `attachment; filename=${req.data.id}.7z`);
    await DI.gridfs.getBlobAsync(sdoc.exeBlob, res);
  }

  @web.get('/')
  async getSubmissionsAction(req, res) {
    if (req.credential.hasPermission(permissions.VIEW_OWN_SUBMISSIONS)) {
      res.redirect(utils.url('/submission/my'));
    } else if (req.credential.hasPermission(permissions.VIEW_ALL_SUBMISSIONS)) {
      res.redirect(utils.url('/submission/all'));
    } else {
      throw new errors.PermissionError();
    }
  }

  @web.get('/all/:page?')
  @web.middleware(utils.sanitizeParam({
    page: sanitizers.pageNumber().optional(1),
  }))
  @web.middleware(utils.checkPermission(permissions.VIEW_ALL_SUBMISSIONS))
  async getAllSubmissionsAction(req, res) {
    const [ sdocs, pages ] = await utils.pagination(
      DI.models.Submission.getAllSubmissionsCursor(),
      req.data.page,
      SUBMISSIONS_PER_PAGE
    );
    await DI.models.User.populate(sdocs, 'user');
    res.render('submission_all', {
      page_title: 'All Submissions',
      sdocs,
      page: req.data.page,
      pages,
    });
  }

  @web.get('/my/:page?')
  @web.middleware(utils.sanitizeParam({
    page: sanitizers.pageNumber().optional(1),
  }))
  @web.middleware(utils.checkPermission(permissions.VIEW_OWN_SUBMISSIONS))
  async getMySubmissionsAction(req, res) {
    const [ sdocs, pages ] = await utils.pagination(
      DI.models.Submission.getUserSubmissionsCursor(req.credential._id),
      req.data.page,
      SUBMISSIONS_PER_PAGE
    );
    await DI.models.User.populate(sdocs, 'user');
    res.render('submission_my', {
      page_title: 'My Submissions',
      sdocs,
      page: req.data.page,
      pages,
    });
  }

  @web.get('/user/:uid/:page?')
  @web.middleware(utils.sanitizeParam({
    uid: sanitizers.objectId(),
    page: sanitizers.pageNumber().optional(1),
  }))
  @web.middleware(utils.checkPermission(permissions.VIEW_OWN_SUBMISSIONS))
  async getUserSubmissionsAction(req, res) {
    const udoc = await DI.models.User.getUserObjectByIdAsync(req.data.uid);
    const [ sdocs, pages ] = await utils.pagination(
      DI.models.Submission.getUserSubmissionsCursor(req.data.uid),
      req.data.page,
      SUBMISSIONS_PER_PAGE
    );
    await DI.models.User.populate(sdocs, 'user');
    res.render('submission_all', {
      page_title: 'User Submissions',
      udoc,
      sdocs,
      page: req.data.page,
      pages,
    });
  }

  @web.get('/create')
  @web.middleware(utils.checkCompleteProfile())
  @web.middleware(utils.checkPermission(permissions.CREATE_SUBMISSION))
  async getSubmissionCreateAction(req, res) {
    const [submitAllowed, nextSubmitRemaining] = await DI.models.Submission.isUserAllowedToSubmitAsync(req.credential._id);
    res.render('submission_create', {
      page_title: 'Submit My Brain',
      submitAllowed,
      nextSubmitRemaining,
    });
  }

  @web.post('/create')
  @web.middleware(utils.sanitizeBody({
    code: sanitizers.nonEmptyString(),
  }))
  @web.middleware(utils.checkCompleteProfile())
  @web.middleware(utils.checkPermission(permissions.CREATE_SUBMISSION))
  async postSubmissionCreateAction(req, res) {
    const sdoc = await DI.models.Submission.createSubmissionAsync(
      req.credential._id,
      req.data.code
    );
    res.redirect(utils.url('/submission/{0}', false, [sdoc._id]));
  }

  @web.get('/:id/:page?')
  @web.middleware(utils.sanitizeParam({
    id: sanitizers.objectId(),
    page: sanitizers.pageNumber().optional(1),
  }))
  @web.middleware(utils.checkPermission(permissions.VIEW_ANY_SUBMISSION))
  async getSubmissionDetailAction(req, res) {
    const sdoc = await DI.models.Submission.getSubmissionObjectByIdAsync(req.data.id);
    await sdoc.populate('user').execPopulate();
    const [ mdocs, pages ] = await utils.pagination(
      DI.models.Match.getMatchesForSubmissionCursor(sdoc._id),
      req.data.page,
      SUBMISSIONS_PER_PAGE
    );
    await DI.models.User.populate(mdocs, 'u1 u2');
    await DI.models.Submission.populate(mdocs, 'u1Submission u2Submission');
    res.render('submission_detail', {
      page_title: 'Submission Detail',
      sdoc,
      mdocs,
      pages,
      page: req.data.page,
      getRelativeStatus: (status, mdoc) => DI.models.Match.getRelativeStatus(status, mdoc.u1.equals(sdoc.user)),
      context: {
        id: sdoc._id,
        page: req.data.page,
      },
    });
  }

  static async socketHandleSubmissionStatusUpdate(socket, sdocid) {
    try {
      const timestamp = Date.now();
      const sdoc = await DI.models.Submission.getSubmissionObjectByIdAsync(sdocid);
      await sdoc.populate('user').execPopulate();
      socket.emit('update_body', {
        html: DI.webTemplate.render('partials/submission_detail_body.html', { sdoc }),
        tsKey: 'sdoc',
        tsValue: timestamp,
      });
      socket.emit('update_status', {
        html: DI.webTemplate.render('partials/submission_detail_status.html', { sdoc }),
        tsKey: 'sdoc',
        tsValue: timestamp,
      });
    } catch (err) {
      DI.logger.error(err.stack);
    }
  }

  static async socketHandleMatchUpdate(socket, mdocid, sdocid) {
    try {
      const timestamp = Date.now();
      const mdoc = await DI.models.Match.getMatchObjectByIdAsync(mdocid);
      await mdoc.populate('u1 u2 u1Submission u2Submission').execPopulate();
      const sdoc = await DI.models.Submission.getSubmissionObjectByIdAsync(sdocid);
      socket.emit('update_match_row', {
        html: DI.webTemplate.render('partials/submission_detail_match_row.html', {
          mdoc,
          sdoc,
          getRelativeStatus: (status, mdoc) => DI.models.Match.getRelativeStatus(status, mdoc.u1.equals(sdoc.user)),
        }),
        tsKey: `mdoc_${mdocid}`,
        tsValue: timestamp,
      });
    } catch (err) {
      DI.logger.error(err.stack);
    }
  }

  @socket.namespace('/submission_detail')
  async socketSubmissionDetailConnect(socket, query, nsp) {
    if (query.page != 1) {
      return;
    }
    await Handler.socketHandleSubmissionStatusUpdate(socket, query.id);
    socket.listenBus('submission.status:updated', async sdoc => {
      if (!sdoc._id.equals(query.id)) {
        return;
      }
      await Handler.socketHandleSubmissionStatusUpdate(socket, sdoc._id);
    });
    async function onMatchUpdated (mdoc) {
      if (!mdoc.u1Submission.equals(query.id) && !mdoc.u2Submission.equals(query.id)) {
        return;
      }
      await Handler.socketHandleMatchUpdate(socket, mdoc._id, query.id);
    }
    socket.listenBus('match:created', onMatchUpdated);
    socket.listenBus('match.status:updated', onMatchUpdated);
    socket.listenBus('match.rounds:updated', onMatchUpdated);
  }

  @web.post('/:id/rejudge')
  @web.middleware(utils.sanitizeParam({
    id: sanitizers.objectId(),
  }))
  @web.middleware(utils.checkPermission(permissions.REJUDGE_SUBMISSION))
  async postSubmissionRejudgeAction(req, res) {
    const sdoc = await DI.models.Submission.recompileAsync(req.data.id);
    res.redirect(utils.url('/submission/{0}', false, [sdoc._id]));
  }

}
