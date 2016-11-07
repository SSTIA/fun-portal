import socketIo from 'socket.io-client';

const io = {
  connect(namespace, query = {}) {
    return socketIo(namespace, {
      path: `${UiContext.urlPrefix}/socket`,
      query: $.param(query),
    });
  },
};

export default io;
