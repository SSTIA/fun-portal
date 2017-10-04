const permissions = {};

let bit = 0;

permissions.NONE                        = 0;

permissions.PROFILE                     = 1 << (bit++);
permissions.VIEW_ANY_PROFILE            = 1 << (bit++);

permissions.VIEW_ALL_SUBMISSIONS        = 1 << (bit++);
permissions.VIEW_OWN_SUBMISSIONS        = 1 << (bit++);
permissions.VIEW_ANY_SUBMISSION         = 1 << (bit++);
permissions.VIEW_ANY_SUBMISSION_CODE    = 1 << (bit++);
permissions.CREATE_SUBMISSION           = 1 << (bit++);
permissions.BYPASS_SUBMISSION_LIMIT     = 1 << (bit++);
permissions.BYPASS_SUBMISSION_LOCK      = 1 << (bit++);
permissions.BYPASS_SUBMISSION_QUOTA     = 1 << (bit++);
permissions.REJUDGE_SUBMISSION          = 1 << (bit++);

permissions.VIEW_SCOREBOARD             = 1 << (bit++);

permissions.VIEW_MANAGE_PORTAL          = 1 << (bit++);

permissions.REFRESH_MATCH_STATUS        = 1 << (bit++);
permissions.REFRESH_SUBMISSION_STATUS   = 1 << (bit++);

export default permissions;
