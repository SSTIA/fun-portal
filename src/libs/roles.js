import permissions from './permissions';

const roles = {
  guest:    permissions.VIEW_ALL_SUBMISSIONS  |
            permissions.VIEW_ANY_SUBMISSION   |
            permissions.VIEW_SCOREBOARD       ,

  student:  permissions.PROFILE               |
            permissions.VIEW_OWN_SUBMISSIONS  |
            permissions.VIEW_ALL_SUBMISSIONS  |
            permissions.VIEW_ANY_SUBMISSION   |
            permissions.CREATE_SUBMISSION     |
            permissions.VIEW_SCOREBOARD       ,

  admin:    -1                                ,
};

export default roles;
