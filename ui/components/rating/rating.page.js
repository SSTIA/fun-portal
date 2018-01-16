import { AutoloadPage } from '../../misc/PageLoader';

function runRating($container) {
  console.log($container);
  for (const element of $container.find('span.rating[data-title]')) {
    const $element = $(element);
    $element.attr('data-tooltip', $element.attr('data-title'));
  }
  for (const element of $container.find('span.player[data-title]')) {
    const $element = $(element);
    const str = `${$element.attr('data-title')} ${$element.html()}`;
    $element.attr('data-tooltip', str);
  }
}

function cancelRating($container) {
  /*for (const element of $container.find('span.time[data-timestamp]')) {
    const $element = $(element);
    const timeago = $element.data('timeago');
    if (timeago === undefined) {
      continue;
    }
    timeago.cancel();
    $element.removeData('timeago');
  }*/
}

const ratingPage = new AutoloadPage(() => {
  runRating($('body'));
  //$(document).on('vjContentNew', e => runRelativeTime($(e.target)));
  //$(document).on('vjContentRemove', e => cancelRelativeTime($(e.target)));
});

export default ratingPage;
