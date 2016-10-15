const credential = {};

credential.populateCredentialFromSession = async (req) => {
  if (req.session.userCredential) {
    try {
      req.credential = await DI.models.User.findOne({ _id: req.session.userCredential });
    } catch (e) {
      req.credential = null;
    }
  } else {
    req.credential = null;
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
