import { argv } from 'yargs';
import _ from 'lodash';

async function main() {
  if (argv._.length === 0) {
    throw new Error('Expect at least one argument');
  }
  const [funcName, ...args] = argv._;
  const func = _.get(global, funcName);
  if (!_.isFunction(func)) {
    throw new Error(`"${funcName}" is not a callable function`);
  }
  const ret = await func(...args);
  console.log(ret);
}

export default async () => {
  try {
    await main();
  } catch (e) {
    console.error(e.stack);
  }
  await application.shutdown();
};
