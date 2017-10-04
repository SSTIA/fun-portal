import rp from 'request-promise-native';
import utils from 'libs/utils';
import {OAuth2} from 'oauth';

const sso = {}, oauth2 = {};

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

let sjtuOAuth2 = new OAuth2(DI.config.sso.id,
                    DI.config.sso.secret,
                    'https://jaccount.sjtu.edu.cn/oauth2/',
                    'authorize',
                    'token');

oauth2.constructAuthUrl = () => sjtuOAuth2.getAuthorizeUrl({
  redirect_uri: utils.url('/sso/sjtu/redirect', true),
  scope: 'basic essential',
  response_type: 'code',
});

oauth2.getToken = (code) => {
  let options = {
    client_id: sjtuOAuth2._clientId,
    client_secret: sjtuOAuth2._clientSecret,
    grant_type: 'authorization_code',
    redirect_uri: utils.url('/sso/sjtu/redirect', true),
    code,
  };

  return rp({
    method: 'POST',
    url: sjtuOAuth2._getAccessTokenUrl(),
    form: options,
    json: true,
  });
};

oauth2.getInfo = async (token) => {
  let options = {
    access_token: token,
  };

  return await rp({
    method: 'GET',
    url: 'https://api.sjtu.edu.cn/v1/me/profile',
    qs: options,
    json: true,
  });
};

export default sso;

export {oauth2};
