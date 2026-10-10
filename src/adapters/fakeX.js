import { HttpPublisher } from "./SocialPublisher.js";

export class FakeXPublisher extends HttpPublisher {
  get platform() { return "x"; }
  async publish({ caption, image, idempotencyKey, accessToken }) {
    // X's shape differs from Instagram's: `text` + `media_base64`
    const { data, replayed } = await this.call("POST", "/v1/x/tweets", {
      token: accessToken,
      headers: { "idempotency-key": idempotencyKey },
      body: { text: caption, media_base64: image.toString("base64") },
    });
    return { externalId: data.id, status: data.status, replayed };
  }
}
