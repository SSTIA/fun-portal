import 'highlight.js/styles/vs.css';
import hljs from 'highlight.js/lib/highlight.js';

import langCpp from 'highlight.js/lib/languages/cpp.js';

hljs.registerLanguage('cpp', langCpp);

const hljsApiWrap = {

  highlightBlocks: ($dom) => {
    for (const block of $dom.find('pre code')) {
      hljs.highlightBlock(block);
    }
  },

};

export default hljsApiWrap;
