export default class GomokuBoard {
  constructor($dom, options) {
    this.$dom = $dom;
    this.options = options;
    this.board = [];
    this.$cells = [];
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
          tBody += `<td class="cell pos-${col - 1}-${row - 1}">`;
        }
        tBody += '<div class="content" layout="row center-center">';
        if (isHeadingRow && !isHeadingCol) {
          tBody += String(col - 1);
        } else if (!isHeadingRow && isHeadingCol) {
          tBody += String(row - 1);
        } else if (!isHeadingRow && !isHeadingCol) {
          tBody += `<div class="stone pos-${col - 1}-${row - 1}" data-field="0" data-order="" layout="row center-center"></div>`;
        }
        tBody += '</div></td>';
      }
      tBody += '</tr>\n';
    }
    this.$dom.html(`<table class="board-table"><tbody>${tBody}</tbody></table>`);

    const $cells = this.$dom.find('.stone');
    let idx = 0;
    for (let row = 0; row < this.options.height; ++row) {
      const $cRow = [];
      const bRow = [];
      for (let col = 0; col < this.options.width; ++col) {
        $cRow.push($cells.eq(idx));
        bRow.push(0);
        idx++;
      }
      this.$cells.push($cRow);
      this.board.push(bRow);
    }
  }

  setBoard(boardMap, orderMap = null) {
    boardMap.forEach((row, y) => {
      row.forEach((v, x) => {
        const $cell = this.$cells[y][x];
        if (this.board[y][x] !== v) {
          $cell.attr('data-field', v);
          this.board[y][x] = v;
        }
        if (orderMap) {
          $cell.attr('data-order', orderMap[y][x]);
        }
      });
    });
  }
}
