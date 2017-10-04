import permissions from './permissions';

const roles = {};

roles.guest =
  permissions.VIEW_ALL_SUBMISSIONS      |
  permissions.VIEW_ANY_SUBMISSION       |
  permissions.VIEW_SCOREBOARD           |
  permissions.NONE                      ;

roles.student =
  permissions.PROFILE                   |
  permissions.VIEW_OWN_SUBMISSIONS      |
  permissions.VIEW_ALL_SUBMISSIONS      |
  permissions.VIEW_ANY_SUBMISSION       |
  permissions.CREATE_SUBMISSION         |
  permissions.VIEW_SCOREBOARD           |
  permissions.NONE                      ;

roles.mod =
  roles.student                         |
  permissions.VIEW_ANY_PROFILE          |
  permissions.VIEW_ANY_SUBMISSION_CODE  |
  permissions.BYPASS_SUBMISSION_LIMIT   |
  permissions.NONE                      ;

roles.admin = -1;

export default roles;
