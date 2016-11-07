import { NamedPage } from '../misc/PageLoader';
import io from '../utils/io';
import domUpdate from '../utils/domUpdate';

const page = new NamedPage('submission_detail', () => {
  const socket = io.connect('/submission/submission_detail', { ...Context });
  const $rows = $('#match_row_container');

  function hasMatches() {
    return ($rows.children().length > 0);
  }

  let currentHasMatches = hasMatches();
  function updateConditionalVisibility() {
    const newHasMatches = hasMatches();
    if (currentHasMatches !== newHasMatches) {
      if (newHasMatches) {
        $('[data-hide-when="no_match"]').show();
        $('[data-hide-when="match"]').hide();
      } else {
        $('[data-hide-when="no_match"]').hide();
        $('[data-hide-when="match"]').show();
      }
      currentHasMatches = newHasMatches;
    }
  }

  domUpdate.setup(socket, {
    update_body: {},
    update_status: {},
    update_match_row: {
      $container: $rows,
      strategy: 'prepend',
      postApply: updateConditionalVisibility,
    },
  });
});

export default page;
