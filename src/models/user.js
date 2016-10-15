import bcrypt from 'bcrypt-as-promised';
import mongoose from 'mongoose';
import objectId from 'libs/objectId';
import errors from 'libs/errors';
import roles from 'libs/roles';
import sso from 'libs/sso';

export default () => {

  const schema = {
    userName: String,
    userName_std: String,
    isSsoAccount: Boolean,
    role: String,
    hash: String,   // only for isSsoAccount=false
    profile: {
      realName: String,
      studentId: String,
      displayName: String,
      teacher: String,
      initial: Boolean,
    },
  };

  const UserSchema = new mongoose.Schema(schema, { timestamps: true });

  /**
   * Normalize the userName
   * @return {String}
   */
  UserSchema.statics.normalizeUserName = function (userName) {
    return String(userName).toLowerCase().trim();
  };

  /**
   * Build userName for SSO account
   * @return {String}
   */
  UserSchema.statics.buildSsoUserName = function ({studentId}) {
    return `sso_${studentId}`;
  };

  /**
   * Get user object by userName
   * @return {User} Mongoose user object
   */
  UserSchema.statics.getUserObjectByUserNameAsync = async function (userName, throwWhenNotFound = true) {
    const userNameNormalized = this.normalizeUserName(userName);
    const user = await this.findOne({ userName_std: userNameNormalized });
    if (user === null && throwWhenNotFound) {
      throw new errors.UserError('User not found');
    }
    return user;
  };

  /**
   * Get the user object by userId
   * @return {User} Mongoose user object
   */
  UserSchema.statics.getUserObjectByIdAsync = async function (id, throwWhenNotFound = true) {
    if (!objectId.isValid(id)) {
      if (throwWhenNotFound) {
        throw new errors.UserError('User not found');
      } else {
        return null;
      }
    }
    const user = await this.findOne({ _id: id });
    if (user === null && throwWhenNotFound) {
      throw new errors.UserError('User not found');
    }
    return user;
  };

  /**
   * Insert a new SSO account
   * @return {User} Newly created user object
   */
  UserSchema.statics.createSsoUserAsync = async function ({realName, studentId}) {
    const userName = this.buildSsoUserName({ studentId });
    if (await this.getUserObjectByUserNameAsync(userName, false) !== null) {
      throw new errors.UserError('Username already taken');
    }
    const newUser = new this({
      isSsoAccount: true,
      role: 'student',
      profile: {
        realName,
        studentId,
        displayName: realName,
        teacher: '',
        initial: true,
      },
    });
    newUser.setUserName(userName);
    try {
      await newUser.save();
    } catch (e) {
      if (e.name === 'MongoError' && e.code === 11000) {
        // duplicate key error
        throw new errors.UserError('Username already taken');
      } else {
        throw e;
      }
    }
    return newUser;
  };

  /**
   * Insert a new non-SSO account
   * @return {User} Newly created user object
   */
  UserSchema.statics.createNonSsoUserAsync = async function ({userName, password}) {
    if (await this.getUserObjectByUserNameAsync(userName, false) !== null) {
      throw new errors.UserError('Username already taken');
    }
    const newUser = new this({
      isSsoAccount: false,
      role: 'student',
      profile: {
        realName: '',
        studentId: '',
        displayName: userName,
        teacher: '',
        initial: true,
      },
    });
    newUser.setUserName(userName);
    await newUser.setPasswordAsync(password);
    try {
      await newUser.save();
    } catch (e) {
      if (e.name === 'MongoError' && e.code === 11000) {
        // duplicate key error
        throw new errors.UserError('Username already taken');
      } else {
        throw e;
      }
    }
    return newUser;
  };

  /**
   * Retrive an user object and verify its credential
   * @return {User} The user object if password matches
   */
  UserSchema.statics.authenticateAsync = async function (userName, password) {
    const user = await this.getUserObjectByUserNameAsync(userName);
    const match = await user.testPasswordAsync(password);
    if (!match) {
      throw new errors.UserError('Incorrect username or password');
    }
    return user;
  };

  /**
   * Verify an SSO sign
   * @return {User} The user object if the sso token is valid
   */
  UserSchema.statics.authenticateSsoAsync = async function (directory) {
    const resp = await sso.getPropertiesAsync(directory);
    if (resp.ok !== true) {
      throw new errors.UserError('Session expired. Please sign in again.');
    }
    const studentId = resp.properties.UserToken;
    const userName = this.buildSsoUserName({ studentId });
    const user = await this.getUserObjectByUserNameAsync(userName, false);
    if (user === null) {
      // not signed in before. create a new account
      // realname API is not working anymore :(
      return await this.createSsoUserAsync({ realName: '', studentId });
    }
    return user;
  };

  /**
   * Update the profile of a user
   * @return {User} The new user object
   */
  UserSchema.statics.updateProfileAsync = async function (userId, profile) {
    if (profile !== Object(profile)) {
      throw new Error('Parameter `profile` should be an object');
    }
    const user = await this.getUserObjectByIdAsync(userId);
    user.profile = {
      ...profile,
      initial: false,
    };
    if (user.profile.displayName) {
      user.profile.displayName = user.profile.displayName.substr(0, 15);
    }
    await user.save();
    return user;
  };

  /**
   * Check whether a user has a permission
   * @return {Boolean}
   */
  UserSchema.methods.hasPermission = function (perm) {
    if (this.role === undefined) {
      return false;
    }
    if (roles[this.role] === undefined) {
      return false;
    }
    return (roles[this.role] & perm) !== 0;
  };

  /**
   * Set the userName and userName_std
   */
  UserSchema.methods.setUserName = function (userName) {
    this.userName = userName;
    this.userName_std = UserSchema.statics.normalizeUserName(userName);
  };

  /**
   * Set the password hash
   */
  UserSchema.methods.setPasswordAsync = async function (plain) {
    this.hash = await bcrypt.hash(plain, 10);
  };

  /**
   * Test whether a password matches the hash
   */
  UserSchema.methods.testPasswordAsync = async function (password) {
    try {
      await bcrypt.compare(password, this.hash);
    } catch (e) {
      if (e instanceof bcrypt.MISMATCH_ERROR) {
        return false;
      } else {
        throw e;
      }
    }
    return true;
  };

  UserSchema.index({ userName_std: 1 }, { unique: true });

  return mongoose.model('User', UserSchema);
};
