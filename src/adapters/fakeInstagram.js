import { HttpPublisher } from "./SocialPublisher.js";

export class FakeInstagramPublisher extends HttpPublisher {
  get platform() { return "instagram"; }
  async publish({ caption, image, idempotencyKey, accessToken }) {
    const { data, replayed } = await this.call("POST", "/v1/instagram/media", {
      token: accessToken,
      headers: { "idempotency-key": idempotencyKey },
      body: { caption, image_base64: image.toString("base64") },
    });
    return { externalId: data.id, status: data.status, replayed };
  }
}
