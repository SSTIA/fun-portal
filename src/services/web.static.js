import express from 'express';

export default (app) => {

  app.use(express.static(`${__projectRoot}/.uibuild`));

};
