export function createAccountRepo(db) {
  const get = db.prepare("SELECT * FROM accounts WHERE platform=?");
  const up = db.prepare(`INSERT INTO accounts (platform,access_token_enc,refresh_token_enc,expires_at,updated_at) VALUES (@platform,@a,@r,@exp,@now)
    ON CONFLICT(platform) DO UPDATE SET access_token_enc=@a, refresh_token_enc=@r, expires_at=@exp, updated_at=@now`);
  return {
    get: (p) => get.get(p),
    upsert: (platform, a, r, exp, now) => up.run({ platform, a, r, exp, now }),
    list: () => db.prepare("SELECT platform, expires_at, updated_at FROM accounts").all(),
  };
}
