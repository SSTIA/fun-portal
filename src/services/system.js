import _ from 'lodash';

export default async () => {

  const initRating = async function() {
    const rdocs = await DI.models.Rating.getExceptionRatingAsync();
    _.forEach(rdocs, async rdoc => {
      DI.logger.info(`Fixing Rating Object ${rdoc._id}`);
      await rdoc.resetExceptionAsync();
    });
  };

  const initSubmission = async function() {
    const sdocs = await DI.models.getExceptionSubmissionAsync();
    _.forEach(sdocs, async sdoc => {
      DI.logger.info(`Fixing Submission Object ${sdoc._id}`);
      await sdoc.resetExceptionAsync();
    });
  };

  const system = {
    initialized: false,
    init: async () => {
      DI.logger.info('Initialization started');
      system.initialized = false;
      await DI.model.sys.setAsync('readonly', true);

      try {
        await initRating();
        await initSubmission();

      } catch (e) {
        DI.logger.error(e.stack);
        DI.logger.info('Initialization failed!');
        process.exit(-1);
      }

      system.initialized = true;
      await DI.model.sys.setAsync('readonly', false);
      DI.logger.info('Initialization succeeded');
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

