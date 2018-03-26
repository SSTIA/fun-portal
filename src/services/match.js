import Aigle from 'aigle';
import utils from 'libs/utils';

export default async (_maxMatch = 5) => {

  let readyExit = false;
  let delay = 0;
  let maxMatch = _maxMatch;

  const match = async function() {
    const PER_PAGE = 10;
    let pages = 1;
    for (let page = 1; page <= pages; page++) {
      let udocs;
      [udocs, pages] = await utils.pagination(
        DI.models.User.getHighestPriority(),
        page,
        PER_PAGE,
      );
      for (let i = 0; i < udocs.length; i++) {
        const u1 = udocs[i];
        const u2 = await DI.models.User.getBestOpponentAsync(u1);
        //console.log(u1, u2);
        //return false;
        if (u2) {
          //console.log(u1._id, u2._id);
          await DI.models.Match.createMatchAsync(u1, u2);
          return true;
        } else {
          //console.log(u1._id, null);
        }
      }
    }
    return false;
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

  DI.logger.info('Matching service started');
  process.on('SIGINT', () => {
    DI.logger.info('Matching service received SIGINT, exiting');
    readyExit = true;
  });
  await loop();

};
