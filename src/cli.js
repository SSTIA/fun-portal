import 'source-map-support/register';
import 'app-module-path/register';
import fs from 'fs-promise';
import FrameworkEntry from 'dg-framework';

import path from 'path';
// without ending slash!
global.__codeRoot = path.join(__dirname, '.');
global.__projectRoot = path.join(__dirname, '..');
process.env.SUPPRESS_NO_CONFIG_WARNING = true;

(async function start() {

  if (process.getuid && process.getuid() === 0) {
    console.error('Do not run in super privilege.');
    process.exit(1);
    return;
  }

  let envProfile = 'debug';
  try {
    await fs.stat(`${__projectRoot}/.debug`);
  } catch (ignore) {
    envProfile = 'production';
  }

  const application = new FrameworkEntry({
    env: envProfile,
    config: ['config.yaml', 'config.debug.yaml', 'config.production.yaml'],
    services: 'services_cli.yaml',
    loadModule: (path) => require(`${__codeRoot}/services/${path}`).default,
    shutdownModule: (path) => require(`${__codeRoot}/services/${path}`).shutdown,
  });

  global.application = application;
  global.DI = application.DI;

  application.start().catch(e => console.log(e.stack));

})();
