import _ from 'lodash';
import diff from '../utils/diff';

const domUpdate = {};

domUpdate.setup = (socket, config) => {
  _.forEach(config, (_updateConfig, eventName) => {
    const lastTimestamps = {};
    const updateConfig = {
      $container: $(document),
      ..._updateConfig,
    };
    socket.on(eventName, udoc => {
      if (udoc.tsKey && udoc.tsValue) {
        if (
          lastTimestamps[udoc.tsKey] === undefined ||
          lastTimestamps[udoc.tsKey] < udoc.tsValue
        ) {
          lastTimestamps[udoc.tsKey] = udoc.tsValue;
          diff.applyForId({
            newHtml: udoc.html,
            ...updateConfig,
          });
        }
      }
    });
  });
};

export default domUpdate;
