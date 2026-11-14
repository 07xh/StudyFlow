import { test } from "node:test";
import assert from "node:assert/strict";
import worker, {normalizeCode} from "../src/index.mjs";

test("activation code format is strict", () => {
  assert.equal(normalizeCode("sf-aaaaaaaa-bbbbbbbb-cccccccc-dddddddd"), "SF-AAAAAAAA-BBBBBBBB-CCCCCCCC-DDDDDDDD");
  assert.equal(normalizeCode("SF-A"), null);
  assert.equal(normalizeCode("sf-AAAA-AAAA-AAAA-AAAA"), null);
});
test("unconfigured service cannot authorize requests", async () => {
  const result = await worker.fetch(new Request("https://example.test/v1/activate", {method:"POST"}), {});
  assert.equal(result.status,503);
  assert.equal((await result.json()).error, "SERVICE_NOT_CONFIGURED");
});
test("admin refuses users without Access proof", async () => {
  const result = await worker.fetch(new Request("https://example.test/admin"), {
    DB:{},CODE_PEPPER:"test",LICENSE_PRIVATE_KEY:"x",LICENSE_PUBLIC_KEY:"x"
  });
  assert.equal(result.status,403);
});
