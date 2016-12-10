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

@socket.enable()
@web.controller('/match')
export default class Handler {

  @web.post('/api/roundBegin')
  @web.middleware(utils.sanitizeBody({
    mid: sanitizers.nonEmptyString(),
    rid: sanitizers.nonEmptyString(),
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
      }
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
      const mdoc = await DI.models.Match.judgeCompleteRoundAsync(
        req.data.mid,
        req.data.rid,
        DI.models.Match.getStatusFromJudgeExitCode(req.data.exitCode),
        {
          summary: req.data.summary,
          logBlobStream: fsp.createReadStream(req.file.path),
          text: '',
        }
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
        html: DI.webTemplate.render('partials/match_detail_match_status.html', { mdoc }),
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
      const rdoc = mdoc.rounds ? mdoc.rounds.find(rdoc => rdoc._id.equals(rdocid)) : undefined;
      if (!rdoc) {
        return;
      }
      socket.emit('update_round_row', {
        html: DI.webTemplate.render('partials/match_detail_round_row.html', { mdoc, rdoc }),
        tsKey: `rdoc_${rdoc._id}`,
        tsValue: timestamp,
      });
    } catch (err) {
      DI.logger.error(err.stack);
    }
  }

  @socket.namespace('/match_detail')
  async socketMatchDetailConnect(socket, query, nsp) {
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
    const rdocIndex = mdoc.rounds.findIndex(rdoc => rdoc._id.equals(req.params.rid));
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
