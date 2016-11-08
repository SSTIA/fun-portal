import { AutoloadPage } from '../../misc/PageLoader';
import highlight from '../highlighter/highlight';

function runHighlight($container) {
  highlight.highlightBlocks($container);
}

const highlighterPage = new AutoloadPage(() => {
  $(document).on('vjContentNew', e => runHighlight($(e.target)));
});

export default highlighterPage;
