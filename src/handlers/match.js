import * as web from 'express-decorators';
import multer from 'multer';
import fsp from 'fs-promise';
import utils from 'libs/utils';
import sanitizers from 'libs/sanitizers';
import errors from 'libs/errors';
import permissions from 'libs/permissions';
import socket from 'libs/socket';

// file limit is infinity
const logUpload = multer({
  storage: multer.diskStorage({}),
});

const MATCHES_PER_PAGE = 2;

@socket.enable()
@web.controller('/match')
export default class Handler {

  @web.use()
  async navType(req, res, next) {
    res.locals.nav_type = 'match';
    next();
  }

  @web.post('/api/roundBegin')
  @web.middleware(utils.sanitizeBody({
    mid: sanitizers.nonEmptyString(),
    rid: sanitizers.nonEmptyString(),
  }))
  @web.middleware(utils.checkAPI())
  async apiRoundBegin(req, res) {
    const mdoc = await DI.models.Match.judgeStartRoundAsync(
      req.data.mid,
      req.data.rid,
    );
    res.json(mdoc);
  }

  @web.post('/api/roundError')
  @web.middleware(utils.sanitizeBody({
    mid: sanitizers.nonEmptyString(),
    rid: sanitizers.nonEmptyString(),
    text: sanitizers.nonEmptyString(),
  }))
  @web.middleware(utils.checkAPI())
  async apiRoundError(req, res) {
    const mdoc = await DI.models.Match.judgeCompleteRoundAsync(
      req.data.mid,
      req.data.rid,
      DI.models.Match.STATUS_SYSTEM_ERROR,
      {
        text: req.data.text,
      },
    );
    res.json(mdoc);
  }

  @web.post('/api/roundComplete')
  @web.middleware(utils.sanitizeBody({
    mid: sanitizers.nonEmptyString(),
    rid: sanitizers.nonEmptyString(),
    exitCode: sanitizers.int(),
    summary: sanitizers.nonEmptyString(),
  }))
  @web.middleware(logUpload.single('log'))
  @web.middleware(utils.checkAPI())
  async apiRoundComplete(req, res) {
    if (!req.file) {
      throw new errors.UserError('Expect logs');
    }
    try {
      let usedTime = 1 * 60 * 1000;
      try {
        const sdoc = JSON.parse(req.data.summary);
        usedTime = sdoc.elapsedRoundTime[0];
      } catch (err) {
        // failed to extract elapsed round time
        DI.logger.error(err.stack);
      }
      const mdoc = await DI.models.Match.judgeCompleteRoundAsync(
        req.data.mid,
        req.data.rid,
        DI.models.Match.getStatusFromJudgeExitCode(req.data.exitCode),
        {
          summary: req.data.summary,
          usedTime,
          logBlobStream: fsp.createReadStream(req.file.path),
          text: '',
        },
      );
      res.json(mdoc);
    } finally {
      try {
        await fsp.remove(req.file.path);
      } catch (err) {
        DI.logger.error(err.stack);
      }
    }
  }

  @web.get('/')
  @web.middleware(utils.sanitizeParam({
    page: sanitizers.pageNumber().optional(1),
  }))
  async getMatchList(req, res) {
    //const sdoc = await DI.models.Submission.getSubmissionObjectByIdAsync(req.data.id);
    //await sdoc.populate('user').execPopulate();
    const [mdocs, pages] = await utils.pagination(
      DI.models.Match.getAllMatches(),
      req.data.page,
      MATCHES_PER_PAGE,
    );
    await DI.models.User.populate(mdocs, 'u1 u2');
    await DI.models.Submission.populate(mdocs, 'u1Submission u2Submission');
    //const udoc = req.credential;
    //console.log(udoc);
    //console.log(mdocs[0]);
    //console.log(req.credential.equals(mdocs[0].u1));
    //console.log(req.credential.equals(mdocs[0].u2));

    res.render('match_list', {
      page_title: 'Match List',
      udoc: req.credential,
      mdocs,
      pages,
      page: req.data.page,
      getRelativeStatus: (status, mdoc) => status,
      context: {
        //id: sdoc._id,
        page: req.data.page,
      },
    });
  }

  @web.get('/refreshStatus')
  @web.middleware(utils.checkPermission(permissions.REFRESH_MATCH_STATUS))
  async manageRefreshStatus(req, res) {
    const result = await DI.models.Match.refreshAllMatchesAsync();
    res.json(result);
  }

  @web.get('/:id')
  async getMatchDetailAction(req, res) {
    const mdoc = await DI.models.Match.getMatchObjectByIdAsync(req.params.id);
    await mdoc.populate('u1 u2 u1Submission u2Submission').execPopulate();
    res.render('match_detail', {
      page_title: 'Match Detail',
      mdoc,
      context: {
        id: mdoc._id.toString(),
      },
    });
  }

  static async socketHandleMatchStatusUpdate(socket, mdocid) {
    try {
      const timestamp = Date.now();
      const mdoc = await DI.models.Match.getMatchObjectByIdAsync(mdocid);
      socket.emit('update_match_status', {
        html: DI.webTemplate.render('partials/match_detail_match_status.html',
          {mdoc}),
        tsKey: 'mdoc',
        tsValue: timestamp,
      });
    } catch (err) {
      DI.logger.error(err.stack);
    }
  }

  static async socketHandleMatchRoundsUpdate(socket, mdocid, rdocid) {
    try {
      const timestamp = Date.now();
      const mdoc = await DI.models.Match.getMatchObjectByIdAsync(mdocid);
      const rdoc = mdoc.rounds ? mdoc.rounds.find(
        rdoc => rdoc._id.equals(rdocid)) : undefined;
      if (!rdoc) {
        return;
      }
      socket.emit('update_round_row', {
        html: DI.webTemplate.render('partials/match_detail_round_row.html',
          {mdoc, rdoc}),
        tsKey: `rdoc_${rdoc._id}`,
        tsValue: timestamp,
      });
    } catch (err) {
      DI.logger.error(err.stack);
    }
  }

  @socket.namespace('/match_detail')
  async socketMatchDetailConnect(socket, query, nsp) {
    if (!DI.config.web.realtimePush) {
      return;
    }
    socket.listenBus('match.status:updated', async mdoc => {
      if (!mdoc._id.equals(query.id)) {
        return;
      }
      await Handler.socketHandleMatchStatusUpdate(socket, mdoc._id);
    });
    socket.listenBus('match.rounds:updated', async (mdoc, rdoc) => {
      if (!mdoc._id.equals(query.id)) {
        return;
      }
      await Handler.socketHandleMatchRoundsUpdate(socket, mdoc._id, rdoc._id);
    });
  }

  @web.get('/:id/round/:rid')
  async getMatchRoundDetailAction(req, res) {
    const mdoc = await DI.models.Match.getMatchObjectByIdAsync(req.params.id);
    await mdoc.populate('u1 u2 u1Submission u2Submission').execPopulate();
    const rdocIndex = mdoc.rounds.findIndex(
      rdoc => rdoc._id.equals(req.params.rid));
    if (rdocIndex === -1) {
      throw new errors.UserError('Round not found');
    }
    const rdoc = mdoc.rounds[rdocIndex];
    res.render('round_detail', {
      page_title: 'Round Detail',
      mdoc,
      rdoc,
      rdocIndex,
    });
  }

  @web.get('/:id/round/:rid/logs')
  async getMatchRoundLogsAction(req, res) {
    const mdoc = await DI.models.Match.getMatchObjectByIdAsync(req.params.id);
    const rdoc = mdoc.rounds.find(rdoc => rdoc._id.equals(req.params.rid));
    if (rdoc === undefined) {
      throw new errors.UserError('Round not found');
    }
    if (!rdoc.logBlob) {
      throw new errors.UserError('Logs not available for this round');
    }
    //res.setHeader('Content-disposition', `attachment; filename=${req.params.id}-${req.params.rid}.txt`);
    await DI.gridfs.getBlobAsync(rdoc.logBlob, res);
  }

}
