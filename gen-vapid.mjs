// node gen-vapid.mjs  — prints the VAPID public key (for wrangler.toml and the app) and the private JWK (secret).
import { webcrypto as c } from "node:crypto";
const kp = await c.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const raw = Buffer.from(await c.subtle.exportKey("raw", kp.publicKey)).toString("base64url");
const jwk = await c.subtle.exportKey("jwk", kp.privateKey);
console.log("VAPID_PUBLIC_KEY =", raw);
console.log("\nVAPID_PRIVATE_JWK (store as a secret, never commit):\n" + JSON.stringify(jwk));
