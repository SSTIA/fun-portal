import { EventEmitter2 } from 'eventemitter2';
import utils from 'libs/utils';

export default () => {

  const eventBus = new EventEmitter2({
    wildcard: true,
    delimiter: '::',
    newListener: false,
    maxListeners: 0,
  });

  eventBus.emitAsyncWithProfiling = async (name, ...args) => {
    const endProfile = utils.profile(`eventBus.emit(${name})`);
    eventBus.emitAsync(name, ...args);
    endProfile();
  };

  return eventBus;

};
