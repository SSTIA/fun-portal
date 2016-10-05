import { AutoloadPage } from '../../misc/PageLoader';
import Timeago from 'timeago.js';

const timeago = new Timeago();

function runRelativeTime($container) {
  for (const element of $container.find('span.time[data-timestamp]')) {
    const $element = $(element);
    if ($element.attr('datetime') !== undefined) {
      continue;
    }
    $element.attr('data-tooltip', $element.text());
    $element.attr('datetime', ($element.attr('data-timestamp') | 0) * 1000);
    timeago.render(element);
  }
}

const relativeTimePage = new AutoloadPage(() => {
  runRelativeTime($('body'));
});

export default relativeTimePage;
