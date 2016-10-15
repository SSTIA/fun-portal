import rp from 'request-promise-native';

const sso = {};

async function requestAsync(actionUrl, directory) {
  try {
    return await rp({
      url: `${DI.config.ssoUrl}${actionUrl}`,
      qs: {
        sessionid: directory,
      },
      json: true,
    });
  } catch (ignored) {
    throw new Error('Failed to connect to SSO service');
  }
}

sso.getPropertiesAsync = directory => {
  return requestAsync('/session/properties', directory);
};

export default sso;
