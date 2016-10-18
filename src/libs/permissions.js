const permissions = {};

permissions.VIEW_ALL_SUBMISSION         = 1 << 0;
permissions.VIEW_OWN_SUBMISSION         = 1 << 1;
permissions.VIEW_MANAGE_PORTAL          = 1 << 2;
permissions.REFRESH_MATCH_STATUS        = 1 << 3;
permissions.REFRESH_SUBMISSION_STATUS   = 1 << 4;

export default permissions;
