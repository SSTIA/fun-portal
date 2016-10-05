import errorFactory from 'dg-error-factory';
import escapeHtml from 'escape-html';

const errors = {
  PrivilegeError: errorFactory('PrivilegeError', function () {
    this.status = 403;
    this.message = 'You don\'t have the permission to perform this action. Please log in to continue.';
  }),

  UserError: errorFactory('UserError', function () {
    this.status = 400;
  }),

  ValidationError: errorFactory('ValidationError', function (errorMsg) {
    this.status = 400;
    this.message = errorMsg;
  }),
};

export default errors;
