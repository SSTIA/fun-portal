import { AutoloadPage } from '../../misc/PageLoader';
import Timeago from 'timeago.js';

function runRelativeTime($container) {
  for (const element of $container.find('span.time[data-timestamp]')) {
    const $element = $(element);
    if ($element.data('timeago') !== undefined) {
      continue;
    }
    const timeago = new Timeago();
    $element.attr('data-tooltip', $element.text());
    $element.attr('datetime', ($element.attr('data-timestamp') | 0) * 1000);
    timeago.render(element);
    $element.data('timeago', timeago);
  }
}

function cancelRelativeTime($container) {
  for (const element of $container.find('span.time[data-timestamp]')) {
    const $element = $(element);
    const timeago = $element.data('timeago');
    if (timeago === undefined) {
      continue;
    }
    timeago.cancel();
    $element.removeData('timeago');
  }
}

const relativeTimePage = new AutoloadPage(() => {
  runRelativeTime($('body'));
  $(document).on('vjContentNew', e => runRelativeTime($(e.target)));
  $(document).on('vjContentRemove', e => cancelRelativeTime($(e.target)));
});

export default relativeTimePage;
