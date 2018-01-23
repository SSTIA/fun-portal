import _ from 'lodash';

export default async () => {

  const system = {
    initialized: false,
    init: async () => {
      system.initialized = false;
      await DI.model.sys.setAsync('readonly', true);

      const sdocs = await DI.models.getExceptionSubmissionAsync();
      _.forEach(sdocs, sdoc => {

      });

      system.initialized = true;
      await DI.model.sys.setAsync('readonly', false);
    },
  };

  let readyExit = false;
  process.on('SIGINT', async () => {
    DI.logger.info('Server received SIGINT, exiting');
    if (!readyExit) {
      readyExit = true;
      await DI.model.sys.setAsync('readonly', true);
      setInterval(async () => {
        // waiting for all process ending
        process.exit(0);
      }, 1000);
    }
  });

  return system;
};

