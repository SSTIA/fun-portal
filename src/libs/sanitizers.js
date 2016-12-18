import validator from 'validator';
import objectId from 'libs/objectId';

const sanitizers = {};

class Checker {
  constructor(testFunc) {
    this.test = testFunc;
  }
  optional(val) {
    this.optional = true;
    this.optionalValue = val;
    return this;
  }
  in(vals) {
    this.in = true;
    this.inValues = vals;
    return this;
  }
}

sanitizers.int = () => new Checker((any) => {
  if (typeof any === 'number') {
    return Math.floor(any);
  }
  const str = String(any);
  if (!validator.isInt(str)) {
    throw new Error('integer number');
  }
  return validator.toInt(str);
});

sanitizers.string = () => new Checker((any) => {
  if (typeof any === 'string') {
    return any;
  }
  throw new Error('string');
});

sanitizers.nonEmptyString = () => new Checker((any) => {
  if (typeof any === 'string') {
    if (any.trim().length === 0) {
      throw new Error('non empty string');
    }
    return any.trim();
  }
  throw new Error('non empty string');
});

sanitizers.bool = () => new Checker((any) => {
  if (typeof any === 'boolean') {
    return any;
  }
  if (any === 'true') {
    return true;
  } else if (any === 'false') {
    return false;
  }
  throw new Error('boolean');
});

sanitizers.pageNumber = () => new Checker((any) => {
  const str = String(any);
  if (!validator.isInt(str)) {
    throw new Error('page number');
  }
  const num = validator.toInt(str);
  if (num < 1) {
    throw new Error('page number');
  }
  return num;
});

sanitizers.objectId = () => new Checker((any) => {
  const str = String(any);
  if (!objectId.isValid(str)) {
    throw new Error('object id');
  }
  return objectId.create(str);
});

export default sanitizers;
