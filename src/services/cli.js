import { argv } from 'yargs';

export default async () => {

  console.log(argv._);

  await application.shutdown();

};
