import { NamedPage } from '../misc/PageLoader';
import Board from '../components/board';

const page = new NamedPage('round_detail', () => {
  const $roundSummary = $('#roundSummary');
  if ($roundSummary.length > 0) {
    const data = JSON.parse($roundSummary.text());
    $('#roundText').text(`Exit caused by: ${data.exitCausedBy}`);
    if (data.currentBoard) {
      const board = new Board($('#roundBoard'), data.roundConfig);
      board.setBoard(data.currentBoard, data.boardOrder);
    }
  }
});

export default page;
