import { describe, it } from "node:test";
import assert from "node:assert";
import { listOrganisms, getOrganism } from "../src/routes.js";

describe("organisms", () => {
  it("lists the demo organism", () => {
    assert.deepEqual(listOrganisms(), [{ id: "demo", status: "healthy" }]);
  });

  it("returns null for unknown ids", () => {
    assert.equal(getOrganism("missing"), null);
  });
});
