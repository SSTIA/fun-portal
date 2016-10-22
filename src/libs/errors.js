import errorFactory from 'dg-error-factory';

const errors = {
  PermissionError: errorFactory('PermissionError', function (permValue = '?') {
    this.status = 403;
    this.message = `You don\'t have the permission (${permValue}) to perform this action. If you are not signed in, please sign in and try again.`;
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
