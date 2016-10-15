import errorFactory from 'dg-error-factory';

const errors = {
  PermissionError: errorFactory('PermissionError', function () {
    this.status = 403;
    this.message = 'You don\'t have the permission to perform this action.';
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
