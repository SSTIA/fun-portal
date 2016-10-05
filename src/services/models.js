import _ from 'lodash';
import glob from 'glob';

export default () => {

  const models = glob
    .sync(`${__codeRoot}/models/*.js`)
    .map(model => require(model).default());

  return _.keyBy(models, 'modelName');

};
