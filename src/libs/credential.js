import objectId from 'libs/objectId';

const credential = {};

let guestUser = null;

function getGuestUser() {
  if (!guestUser) {
    guestUser = new DI.models.User({
      _id: objectId.create('000000000000000000000000'),
      userName: 'guest',
      userName_std: 'guest',
      role: 'guest',
      profile: {
        displayName: 'guest',
        initial: true,
      },
      submissionNumber: 0,
    });
  }
  return guestUser;
}

credential.populateCredentialFromSession = async (req) => {
  if (req.session.userCredential) {
    try {
      req.credential = await DI.models.User.findOne({ _id: req.session.userCredential });
    } catch (e) {
      req.credential = getGuestUser();
    }
  } else {
    req.credential = getGuestUser();
  }
};

credential.setCredential = async (req, userId) => {
  if (userId === null) {
    req.session.userCredential = null;
  } else {
    req.session.userCredential = String(userId);
  }
  await credential.populateCredentialFromSession(req);
};

export default credential;
