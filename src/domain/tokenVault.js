import crypto from "node:crypto";

// AES-256-GCM with a fresh random 96-bit IV per value. Stored as "v1.<iv>.<tag>.<ciphertext>" (base64url).
// The platform name is bound in as additional authenticated data, so a ciphertext copied from one
// account row to another fails to decrypt.
export function createTokenVault(hexKey) {
  if (!/^[0-9a-f]{64}$/i.test(hexKey || "")) throw new Error("TOKEN_ENC_KEY must be 64 hex characters (32 bytes)");
  const key = Buffer.from(hexKey, "hex");
  const b64 = (b) => b.toString("base64url");
  return {
    encrypt(plain, aad = "") {
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv("aes-256-gcm", key, iv);
      c.setAAD(Buffer.from(aad));
      const ct = Buffer.concat([c.update(String(plain), "utf8"), c.final()]);
      return ["v1", b64(iv), b64(c.getAuthTag()), b64(ct)].join(".");
    },
    decrypt(blob, aad = "") {
      const [v, iv, tag, ct] = String(blob).split(".");
      if (v !== "v1" || !iv || !tag || !ct) throw new Error("bad token blob");
      const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
      d.setAAD(Buffer.from(aad));
      d.setAuthTag(Buffer.from(tag, "base64url"));
      return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
    },
  };
}
