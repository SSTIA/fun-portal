export default async () => {

  await DI.model.sys.setAsync('initialized', false);
  await DI.model.sys.setAsync('readonly', true);

  await DI.model.sys.setAsync('initialized', true);
  await DI.model.sys.setAsync('readonly', false);

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

};

