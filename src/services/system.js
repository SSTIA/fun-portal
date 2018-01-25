import _ from 'lodash';
import aigle from 'aigle';

export default async () => {

  const initModel = async function(name) {
    const model = DI.models[name];
    if (!model) {
      throw new Error(`Model ${name} doesn't exist!`);
    }
    const func = model[`getException${name}Async`];
    if (!func) {
      throw new Error(`Model ${name} doesn't have getException function!`);
    }
    const docs = await func();
    await aigle.forEach(docs, async doc => {
      DI.logger.info(`Fixing ${name} Object ${doc._id}`);
      await doc.resetExceptionAsync();
    });
  };

  let readyExit = false;
  const onExit = async function () {
    DI.logger.info('Server received SIGINT, exiting');
    if (!readyExit) {
      readyExit = true;
      await DI.models.Sys.setAsync('readonly', true);
      await DI.models.Sys.setAsync('lock_submission', true);
      await DI.models.Sys.setAsync('lock_submission_reason', 'System rebooting');
      setInterval(async () => {
        // waiting for all process ending
        process.exit(0);
      }, 1000);
    }
  };

  const system = {
    initialized: false,
    init: async () => {
      DI.logger.info('Initialization started');
      system.initialized = false;
      await DI.models.Sys.setAsync('readonly', true);
      await DI.models.Sys.setAsync('lock_submission', true);
      await DI.models.Sys.setAsync('lock_submission_reason', 'System initializing');

      try {
        await initModel('Rating');
        await initModel('Match');
        await initModel('Submission');
        await initModel('User');
      } catch (e) {
        DI.logger.error(e.stack);
        DI.logger.info('Initialization failed!');
        process.exit(-1);
      }

      await DI.models.Sys.setAsync('lock_submission', false);
      await DI.models.Sys.setAsync('readonly', false);
      system.initialized = true;
      DI.logger.info('Initialization succeeded');

      process.on('SIGINT', onExit);
    },
  };

  return system;
};

