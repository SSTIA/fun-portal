const socket = {};

socket.namespace = (ns) => (target, key, descriptor) => {
  if (target.socketNamespaces === undefined) {
    target.socketNamespaces = {};
  }
  target.socketNamespaces[key] = {
    handler: target[key],
    ns,
  };
  return descriptor;
};

socket.enable = () => (target) => {
  target.prototype.registerSocket = function (io) {
    for (let key in this.socketNamespaces) {
      const { handler, ns } = this.socketNamespaces[key];
      const nsp = io.of(this.baseUrl + ns);
      nsp.on('connection', socket => {
        handler(socket, socket.handshake.query, nsp).catch(err => {
          socket.emit('error', err.message);
          socket.disconnect();
        });
      });
    }
  };
};

export default socket;
