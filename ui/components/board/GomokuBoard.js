export default class GomokuBoard {
  constructor($dom, options) {
    this.$dom = $dom;
    this.options = options;
    this.init();
  }

  init() {
    this.$dom.empty();
    let tBody = '';
    for (let row = 0; row <= this.options.height + 1; ++row) {
      let isHeadingRow = (row === 0 || row === this.options.height + 1);
      tBody += '<tr>';
      for (let col = 0; col <= this.options.width + 1; ++col) {
        let isHeadingCol = (col === 0 || col === this.options.width + 1);
        if (isHeadingRow || isHeadingCol) {
          tBody += '<td class="heading">';
        } else {
          tBody += `<td class="cell pos-${col - 1}-${row - 1}" field="0">`;
        }
        tBody += '<div class="content" layout="row center-center">';
        if (isHeadingRow && !isHeadingCol) {
          tBody += String(col - 1);
        } else if (!isHeadingRow && isHeadingCol) {
          tBody += String(row - 1);
        }
        tBody += '</div></td>';
      }
      tBody += '</tr>\n';
    }
    this.$dom.html(`<table class="board-table"><tbody>${tBody}</tbody></table>`);
  }

  place(boardMap) {
    boardMap.forEach((row, y) => {
      row.forEach((v, x) => {
        this.$dom.find(`.pos-${x}-${y}`).attr('field', v);
      });
    });
  }
}
