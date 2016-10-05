import { EventEmitter2 } from 'eventemitter2';

export default () => {

  const eventBus = new EventEmitter2({
    newListener: false,
    maxListeners: 20,
  });

  return eventBus;

};
