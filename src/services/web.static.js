import express from 'express';

export default (app) => {

  app.use(DI.config.urlPrefix, express.static(`${__projectRoot}/.uibuild`));

};
