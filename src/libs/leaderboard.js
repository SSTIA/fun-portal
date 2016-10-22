import _ from 'lodash';

/**
 * Initialize match counting for a user A.
 * If result of A vs B has been counted,
 * mark matchCounting[A][B] = matchCounting[B][A] = true. (Else false)
 * matchCounting[A][A] should always be true.
 * @return {{ userId(String): Boolean }}
 * @param userId
 * @param allUserIdList
 */
function initializeMatchCounting(userId, allUserIdList) {
  const ret = {};
  allUserIdList.forEach(function(userId) {
    ret[userId] = false;
  });
  ret[userId] = true;
  return ret;
}

/**
 * Get leaderboard info.
 * @param  {Boolean} onlyEffective
 * @return [{
 *   order,
 *   user, (UserModel)
 *   score,
 *   win,
 *   lose,
 *   draw,
 *   submission, (SubmissionModel)
 * }]
 */
export default async function(onlyEffective = true) {
  // Submission Model, see /src/models/submission.js
  const SubmissionModel = DI.models.Submission;
  // Match Model, see /src/models/match.js
  const MatchModel = DI.models.Match;
  // Users Model, see /src/models/match.js
  const UserModel = DI.models.User;

  /**
   * key-value format userId (string) -> latest submission mappings
   */
  const userSubmissionMappings = {};
  /**
   * All listed submissions ObjectId
   */
  const listedSubmissionIds = [];

  /**
   * Get users' final effective submission mappings,
   * schema: [
   *   {
   *     _id: ObjectId of mapped user
   *     submissionId: ObjectId of latest submission
   *   },
   *   {...},
   *   ...
   * ]
   */
  const mappings = await SubmissionModel
    .getLastSubmissionsByUserAsync(onlyEffective);
  /**
   * Transform mappings to key-value format (ObjectId will be parsed to string)
   */
  mappings.forEach((pair) => {
    userSubmissionMappings[pair._id.toString()] = pair.submissionId.toString();
    listedSubmissionIds.push(pair.submissionId);
  });

  /**
   * List of all user models and userIds
   */
  const userList = await UserModel.find({}).exec();
  const userIdsList = userList.map((userDoc) => userDoc._id.toString());

  /**
   * If we have a user collection of [A, B, C, D]
   * taking A as current user, B, C, D as opponent
   * we only count a single match result for A vs B, A vs C, A vs D.
   * Thus we need a map matchCounting,
   * matchCounting[X] will record whether we have counted a match with X as A's opponent.
   */
  const matchCounting = {};
  /**
   * And we need to store score, wins, loses, draws for each user
   */
  const userScoreMapping = {};
  const userWinsMapping = {};
  const userLosesMapping = {};
  const userDrawsMapping = {};

  userList.forEach((userDoc) => {
    const userIdStr = userDoc._id.toString();
    matchCounting[userIdStr] = initializeMatchCounting(
      userIdStr, userIdsList
    );
    userScoreMapping[userIdStr] = 0;
    userWinsMapping[userIdStr] = 0;
    userLosesMapping[userIdStr] = 0;
    userDrawsMapping[userIdStr] = 0;
  });

  /**
   * Get all "useable" matches
   * "useable" means that both submissions of two users are effective submissions
   */
  const matchesList = await MatchModel
    .getPairwiseMatchesForSubmissionsAsync(listedSubmissionIds);

  /**
   * Count result for each user by matches
   */
  matchesList.forEach((match) => {
    const u1IdStr = match.u1.toString();
    const u2IdStr = match.u2.toString();
    // If A vs B score has been counted once, just skip
    if (matchCounting[u1IdStr][u2IdStr]) {
      return null;
    }
    // else we will count score for u1 and u2
    matchCounting[u1IdStr][u2IdStr] = matchCounting[u2IdStr][u1IdStr] = true;
    // score
    userScoreMapping[u1IdStr] += (match.u1Stat.score || 0);
    userScoreMapping[u2IdStr] += (match.u2Stat.score || 0);
    // wins counts
    userWinsMapping[u1IdStr] += (match.u1Stat.win || 0);
    userWinsMapping[u2IdStr] += (match.u2Stat.win || 0);
    // lose counts
    userLosesMapping[u1IdStr] += (match.u1Stat.lose || 0);
    userLosesMapping[u2IdStr] += (match.u2Stat.lose || 0);
    // draw counts
    userDrawsMapping[u1IdStr] += (match.u1Stat.draw || 0);
    userDrawsMapping[u2IdStr] += (match.u2Stat.draw || 0);
  });

  /**
   * Get order from each user
   * @param result
   * @param currentUser
   * @param idx
   * @returns {number}
   */
  const getOrder = (result, currentUser, idx) => {
    if (idx === 0) {
      return 1;
    }
    const prevUser = result[idx - 1];
    if (prevUser.score === currentUser.score) {
      return prevUser.order;
    }
    return idx + 1;
  };

  /**
   * return scoreboard of all users.
   */
  return _(userList)
    .map((userDoc) => ({
      user: userDoc,
      score: userScoreMapping[userDoc._id.toString()],
      win: userWinsMapping[userDoc._id.toString()],
      lose: userLosesMapping[userDoc._id.toString()],
      draw: userDrawsMapping[userDoc._id.toString()],
      submission: userSubmissionMappings[userDoc._id.toString()] || null,
    }))
    .orderBy(['score', 'user._id'], ['desc', 'desc'])
    .reduce((result, user, idx) => {
      result.push(_.assign({}, user, {
        order: getOrder(result, user, idx),
      }));
      return result;
    }, []);
}
