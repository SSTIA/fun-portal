import bluebird from 'bluebird';
import Rascal from 'rascal';

bluebird.promisifyAll(Rascal.Broker);
bluebird.promisifyAll(Rascal.Broker.prototype);

export default async (logger) => {

  const broker = await Rascal.Broker.createAsync(Rascal.withDefaultConfig(DI.config.mq));
  broker.on('error', e => logger.error(e));

  return {
    async publish(publishId, data) {
      const publication = await broker.publishAsync(publishId, data);
      publication.on('error', e => logger.error(e));
      return publication;
    },
  };

};
