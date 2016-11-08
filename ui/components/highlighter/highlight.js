import Prism from 'prismjs/components/prism-core.js';
import 'prismjs/components/prism-clike.js';
import 'prismjs/components/prism-c.js';
import 'prism-themes/themes/prism-vs.css';
import 'prismjs/plugins/line-highlight/prism-line-highlight.js';
import 'prismjs/plugins/line-numbers/prism-line-numbers.js';
import 'prismjs/plugins/line-numbers/prism-line-numbers.css';
import './highlight.styl';

const highlightApi = {
  highlightBlocks: ($dom) => {
    for (const block of $dom.find('pre')) {
      Prism.highlightElement(block);
    }
  },
};

export default highlightApi;
