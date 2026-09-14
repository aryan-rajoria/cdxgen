import { assert, describe, it } from "poku";

import { readOnnxHeader } from "./onnx.js";

describe("readOnnxHeader", () => {
  it("reads ir version, producer, and opsets from a minimal model", () => {
    const header = readOnnxHeader("./test/data/onnx-model.onnx");
    assert.ok(header);
    assert.strictEqual(header.irVersion, 9);
    assert.strictEqual(header.producerName, "cdxgen-test");
    assert.strictEqual(header.producerVersion, "1.2.3");
    assert.strictEqual(header.modelVersion, 42);
    assert.deepStrictEqual(header.opsets, [
      { domain: "", version: 17 },
      { domain: "com.microsoft", version: 1 },
    ]);
  });

  it("returns undefined for non-onnx input", () => {
    // A text file is not a protobuf stream: the reader must not throw and
    // must not report a header.
    assert.strictEqual(readOnnxHeader("./package.json"), undefined);
  });

  it("returns undefined for missing files", () => {
    assert.strictEqual(readOnnxHeader("./test/data/missing.onnx"), undefined);
  });
});
