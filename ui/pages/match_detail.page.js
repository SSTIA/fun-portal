import { NamedPage } from '../misc/PageLoader';
import io from '../utils/io';
import domUpdate from '../utils/domUpdate';

const page = new NamedPage('match_detail', () => {
  const socket = io.connect('/match/match_detail', { ...Context });
  domUpdate.setup(socket, {
    update_match_status: {},
    update_round_row: {
      $container: $('#round_row_container'),
      strategy: 'prepend',
    },
  });
});

export default page;
