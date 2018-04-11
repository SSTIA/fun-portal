import fs from 'fs';
import path from 'path';
import _ from 'lodash';
import moment from 'moment';

const changelog_path = `${__projectRoot}/changelog`;
let changelogs = [];

fs.readdir(changelog_path, (err, files) => {
  if (err) {
    DI.logger.error(`Change logs not initialized: ${err}`);
    return;
  }
  _.forEach(files, file => {
    if (file.match(/\.json$/g)) {
      const data = require(path.join(changelog_path, file));
      data.timestamp = new Date(data.timestamp);
      //data.datetime = moment(data.timestamp).format('LLLL');
      changelogs.push(data);
    }
  });
  changelogs = _.reverse(changelogs);
});

const changelog = {
  all : () => changelogs,
  newest : () => _.first(changelogs),
};

export default changelog;

