import {NamedPage} from '../misc/PageLoader';
import showdown from 'showdown';
import $ from 'jquery';

const converter = new showdown.Converter();
converter.setFlavor('github');

const page = new NamedPage('help_rules', () => {
  $('.content-markdown').each(function () {
    const $this = $(this);
    const text = $this.text();
    $this.html(converter.makeHtml(text));
  });
});

export default page;
