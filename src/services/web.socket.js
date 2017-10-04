import socketio from 'socket.io';
import Socket from 'socket.io/lib/socket.js';

Socket.prototype.listenBus = function (name, callback) {
  if (this._busListeners === undefined) {
    this._busListeners = [];
    this.on('disconnect', () => this.cancelBusListeners());
  }
  this._busListeners.push(name);
  DI.eventBus.on(`${name}::${this.id}`, callback);
};

Socket.prototype.cancelBusListeners = function () {
  this._busListeners.forEach(name => {
    DI.eventBus.removeAllListeners(`${name}::${this.id}`);
  });
};

export default (app, webSession) => {

  const io = socketio(app.server, {
    path: `${DI.config.urlPrefix}/socket`,
  });

  io.use((socket, next) => {
    webSession(socket.request, socket.request.res, next);
  });

  return io;

};
