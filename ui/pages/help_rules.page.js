import {NamedPage} from '../misc/PageLoader';
import showdown from 'showdown';
import $ from 'jquery';
import _ from 'lodash';

const converter = new showdown.Converter();
converter.setFlavor('github');

const page = new NamedPage('help_rules', () => {
  $('.content-markdown').each(function() {
    const $this = $(this);
    const arr = $this.text().split('\n');
    const text = _.map(arr, line => {
      return line.replace(/^\s*/g, '');
    }).join('\n');
    $this.html(converter.makeHtml(text));
    $this.show();
  });
});

export default page;
