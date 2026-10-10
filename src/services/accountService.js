import { AuthError } from "../domain/errors.js";

// Owns OAuth tokens: encrypts before they touch the DB, decrypts only in memory, refreshes when expiring.
export function createAccountService({ accounts, vault, oauth, clock, logger }) {
  const aad = (platform) => `account:${platform}`;
  const SKEW_MS = 60_000;

  function store(platform, t) {
    const now = clock.now();
    accounts.upsert(platform, vault.encrypt(t.access_token, aad(platform)), vault.encrypt(t.refresh_token, aad(platform)),
      now + t.expires_in * 1000, now);
  }

  return {
    async connect(platform, code = `demo-${platform}`) {
      store(platform, await oauth.exchangeCode(code));
      logger.info("account connected", { platform }); // tokens are never logged
    },
    isConnected: (platform) => Boolean(accounts.get(platform)),
    list: () => accounts.list(),

    async accessToken(platform, { forceRefresh = false } = {}) {
      const row = accounts.get(platform);
      if (!row) throw new AuthError(`no connected ${platform} account`);
      if (!forceRefresh && row.expires_at - SKEW_MS > clock.now()) return vault.decrypt(row.access_token_enc, aad(platform));
      const refreshed = await oauth.refresh(vault.decrypt(row.refresh_token_enc, aad(platform)));
      store(platform, refreshed);
      logger.info("token refreshed", { platform });
      return refreshed.access_token;
    },
  };
}
