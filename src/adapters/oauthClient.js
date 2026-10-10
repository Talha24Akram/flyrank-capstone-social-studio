import { AuthError, TransientPublishError } from "../domain/errors.js";

export function createOAuthClient({ baseUrl, clientId, clientSecret, fetchImpl = fetch, timeoutMs = 5000 }) {
  async function token(body) {
    let res;
    try {
      res = await fetchImpl(baseUrl.replace(/\/$/, "") + "/oauth/token", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, ...body }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) { throw new TransientPublishError(`oauth network: ${e.message}`); }
    if (res.status >= 500) throw new TransientPublishError(`oauth ${res.status}`);
    if (!res.ok) throw new AuthError(`oauth rejected (${res.status})`);
    return res.json();
  }
  return {
    exchangeCode: (code) => token({ grant_type: "authorization_code", code }),
    refresh: (refreshToken) => token({ grant_type: "refresh_token", refresh_token: refreshToken }),
  };
}
