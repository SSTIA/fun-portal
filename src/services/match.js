export default () => {

  const match = async function () {
    const u1 = await DI.models.User.getHighestPriorityAsync();
    if (u1 === null) return false;
    const u2 = await DI.models.User.getBestOpponentAsync(u1, u1.match.streak >=
      0);
    if (u2 === null) return false;
    await DI.models.Match.createMatchAsync(u1, u2);
    return true;
  };

  const loop = async function () {
    const flag = await match();
    if (!flag) {
      DI.logger.info('No matching found');
    } else {
      DI.logger.info('Match found');
    }
    console.log(1);
    setTimeout(async function () {
      await DI.eventBus.emitAsyncWithProfiling('service:match:begin');
    }, 1000);
  };

  return function() {
    setTimeout(async function() {
      DI.eventBus.on('service:match:begin', loop);
      await DI.eventBus.emitAsyncWithProfiling('service:match:begin');
    }, 0);
    return 'matching service begins';
  };

};