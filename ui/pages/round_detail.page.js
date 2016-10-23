import { NamedPage } from '../misc/PageLoader';
import Board from '../components/board';

const page = new NamedPage('round_detail', () => {
  const $roundSummary = $('#roundSummary');
  if ($roundSummary.length > 0) {
    const data = JSON.parse($roundSummary.text());
    $('#roundText').text(`Exit caused by: ${data.exitCausedBy}`);
    const board = new Board($('#roundBoard'), data.roundConfig);
    board.place(data.currentBoard);
  }
});

export default page;
