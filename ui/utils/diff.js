import DiffDOM from 'diff-dom';

const diff = {
  /**
   * _options.$container
   * _options.newHtml
   * _options.idField   (optional)
   * _options.strategy  (optional)
   * _options.ddOpt     (optional)
   * _options.postApply (optional)
   */
  applyForId(_options) {
    const options = {
      ddOpt: {},
      strategy: null,
      idField: 'data-id',
      ..._options,
    };
    const dd = new DiffDOM(options.ddOpt);
    const $new = $(options.newHtml);
    const id = $new.attr(options.idField);
    const $old = options.$container.find(`[${options.idField}="${id}"]`);
    if ($old.length === 0) {
      if (options.strategy === 'prepend') {
        options.$container.prepend($new);
        $new.trigger('vjContentNew');
      } else if (options.strategy === 'append') {
        options.$container.append($new);
        $new.trigger('vjContentNew');
      }
    } else {
      $old.trigger('vjContentRemove');
      dd.apply($old[0], dd.diff($old[0], $new[0]));
      $old.trigger('vjContentNew');
      if (options.postApply) {
        options.postApply($old);
      }
    }
  },
};

export default diff;
