import Aigle from 'aigle';

export default () => {

  let readyExit = false;
  let delay = 0;
  let maxMatch = 5;

  const match = async function() {
    const u1 = await DI.models.User.getHighestPriorityAsync();
    if (u1 === null) return false;
    const u2 = await DI.models.User.getBestOpponentAsync(u1, u1.match.streak >=
      0);
    if (u2 === null) return false;
    await DI.models.Match.createMatchAsync(u1, u2);
    return true;
  };

  const loop = async function() {
    await Aigle.doUntil(
      async () => {
        if (delay > 0) {
          delay -= 100;
          await Aigle.delay(100);
          return;
        }
        const matches = await DI.models.Match.getActiveMatchesAsync();
        if (matches && matches.length > maxMatch) {
          DI.logger.info(`Match limit (${maxMatch}) exceeded`);
          delay = 5000;
          return;
        }
        try {
          const flag = await match();
          if (!flag) {
            DI.logger.info('No matching found');
            delay = 5000;
          } else {
            DI.logger.info('Match found');
          }
        } catch (err) {
          DI.logger.error(err);
          delay = 1000;
        }
      },
      () => readyExit,
    );
    DI.logger.info('Matching service ended');
    process.exit(0);
  };

  return async function(_maxMatch = 5) {
    maxMatch = _maxMatch;
    DI.logger.info('Matching service started');
    process.on('SIGINT', () => {
      DI.logger.info('Matching service ready to exit');
      readyExit = true;
    });
    await loop();
  };

};