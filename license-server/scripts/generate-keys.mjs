// Run from license-server/. Private keys never enter the Git repository or Windows installer.
import {generateKeyPairSync,randomBytes} from "node:crypto";
import {writeFileSync} from "node:fs";
const {privateKey,publicKey}=generateKeyPairSync("ed25519");
const secret=privateKey.export({type:"pkcs8",format:"der"}).toString("base64");
const publicKeyBase64=publicKey.export({type:"spki",format:"der"}).subarray(-32).toString("base64");
writeFileSync(".private-key.b64",secret+"\n",{flag:"wx",mode:0o600});
writeFileSync(".public-key.b64",publicKeyBase64+"\n",{flag:"wx",mode:0o600});
writeFileSync(".code-pepper",randomBytes(32).toString("hex")+"\n",{flag:"wx",mode:0o600});
console.log("Created private/public key and pepper files (all Git-ignored).");
console.log("Rust compile-time public key: "+publicKeyBase64);
