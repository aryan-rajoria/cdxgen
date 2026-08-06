import { createHash, createHmac, createCipheriv, pbkdf2Sync, generateKeyPairSync, randomBytes } from "node:crypto";

export function signPayload(secret, payload) {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function fingerprint(data) {
  return createHash("sha512").update(data).digest();
}

export function deriveKey(password, salt) {
  return pbkdf2Sync(password, salt, 100000, 64, "sha256");
}

const key = randomBytes(32);
const cipher = createCipheriv("aes-256-gcm", key, randomBytes(12));
