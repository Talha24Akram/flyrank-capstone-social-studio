import { FakeInstagramPublisher } from "./fakeInstagram.js";
import { FakeXPublisher } from "./fakeX.js";

export function createPublishers(cfg, fetchImpl = fetch) {
  const o = { baseUrl: cfg.platformUrl, timeoutMs: cfg.requestTimeoutMs, fetchImpl };
  const list = [new FakeInstagramPublisher(o), new FakeXPublisher(o)];
  return Object.fromEntries(list.map((p) => [p.platform, p]));
}
