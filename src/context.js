import { openDb } from "./db/connection.js";
import { migrate } from "./db/migrate.js";
import { createClock } from "./domain/clock.js";
import { createTokenVault } from "./domain/tokenVault.js";
import { createLogger } from "./logger.js";
import { createCampaignRepo } from "./repositories/campaigns.js";
import { createEntryRepo } from "./repositories/entries.js";
import { createAccountRepo } from "./repositories/accounts.js";
import { createWebhookEventRepo } from "./repositories/webhookEvents.js";
import { createPublishers } from "./adapters/registry.js";
import { createOAuthClient } from "./adapters/oauthClient.js";
import { createAccountService } from "./services/accountService.js";
import { createCampaignService } from "./services/campaignService.js";
import { createPublishService } from "./services/publishService.js";
import { createWebhookService } from "./services/webhookService.js";

/** Composition root: the only place that knows how the layers are wired together. */
export function createContext(cfg, { db: injectedDb, fetchImpl = fetch, logger, hooks } = {}) {
  const db = injectedDb ?? openDb(cfg.dbPath);
  migrate(db);
  const log = logger ?? createLogger("studio");
  const clock = createClock(db);
  const vault = createTokenVault(cfg.tokenEncKey);
  const repos = {
    campaigns: createCampaignRepo(db), entries: createEntryRepo(db),
    accounts: createAccountRepo(db), events: createWebhookEventRepo(db),
  };
  const oauth = createOAuthClient({ baseUrl: cfg.platformUrl, clientId: cfg.oauthClientId, clientSecret: cfg.oauthClientSecret, fetchImpl, timeoutMs: cfg.requestTimeoutMs });
  const publishers = createPublishers(cfg, fetchImpl);
  const accountService = createAccountService({ accounts: repos.accounts, vault, oauth, clock, logger: log });
  const campaignService = createCampaignService({ db, campaigns: repos.campaigns, entries: repos.entries, clock, cfg });
  const publishService = createPublishService({ entries: repos.entries, accounts: accountService, publishers, clock, cfg, logger: log, hooks });
  const webhookService = createWebhookService({ entries: repos.entries, events: repos.events, clock, cfg, logger: log });
  return { cfg, db, clock, logger: log, repos, accountService, campaignService, publishService, webhookService };
}
