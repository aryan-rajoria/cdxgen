import { closeSync, openSync, readSync, statSync } from "node:fs";

// An ONNX model is a protobuf-encoded ModelProto. Only the header fields are
// read here; the graph payload is skipped by offset, so inspection stays
// cheap for multi-gigabyte files and never loads tensors.
//
// ModelProto fields (https://onnx.ai/onnx/repo-docs/Model.html):
//   1 ir_version (varint), 2 producer_name (string),
//   3 producer_version (string), 4 domain (string),
//   5 model_version (varint), 6 doc_string (string),
//   7 graph (message, skipped), 8 opset_import (repeated message).
// Each opset_import entry is an OperatorSetIdProto:
//   1 domain (string), 2 version (varint).

/** Fields are walked from the front; a hostile file cannot force a scan
 * deeper than this many top-level entries. */
const MAX_TOP_LEVEL_FIELDS = 128;
/** Largest single field payload that will actually be read into memory. */
const MAX_FIELD_BYTES = 4096;

/**
 * Read the identifying header fields of an ONNX model file.
 *
 * Only `ir_version`, `producer_name`, `producer_version`, `model_version`,
 * and the `opset_import` entries are extracted. The graph and every other
 * payload are skipped by offset without being read, so no tensor data is
 * ever loaded and no model code is executed.
 *
 * @param {string} filePath Path to the `.onnx` file
 * @returns {{
 *   irVersion: number,
 *   producerName: string,
 *   producerVersion: string,
 *   modelVersion: number,
 *   opsets: Array<{domain: string, version: number}>,
 * } | undefined} Header summary, or undefined when it cannot be read
 */
export function readOnnxHeader(filePath) {
  let fd;
  try {
    const stats = statSync(filePath);
    if (!stats.isFile() || stats.size < 2) {
      return undefined;
    }
    fd = openSync(filePath, "r");
    // The whole file is not buffered; fields are fetched by offset. A small
    // sliding buffer is re-used for varints and short strings.
    const reader = new OffsetReader(fd, stats.size);
    const result = {
      irVersion: 0,
      producerName: "",
      producerVersion: "",
      modelVersion: 0,
      opsets: [],
    };
    let fieldsRead = 0;
    for (let i = 0; i < MAX_TOP_LEVEL_FIELDS; i += 1) {
      const tag = reader.readVarint();
      if (tag === undefined) {
        break;
      }
      const fieldNumber = Number(tag >> 3n);
      const wireType = Number(tag & 7n);
      if (fieldNumber === 0) {
        break;
      }
      if (wireType === 0) {
        const value = reader.readVarint();
        if (value === undefined) {
          break;
        }
        fieldsRead += 1;
        if (fieldNumber === 1) {
          result.irVersion = Number(value);
        } else if (fieldNumber === 5) {
          result.modelVersion = Number(value);
        }
        continue;
      }
      if (wireType !== 2) {
        // Group and fixed-width wire types do not appear in ModelProto at the
        // top level; stop rather than guess their length.
        break;
      }
      const length = reader.readVarint();
      if (length === undefined) {
        break;
      }
      const byteLength = Number(length);
      if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
        break;
      }
      if (fieldNumber === 8 && byteLength <= MAX_FIELD_BYTES) {
        const payload = reader.readBytes(byteLength);
        if (!payload) {
          break;
        }
        const opset = parseOperatorSetEntry(payload);
        if (opset) {
          result.opsets.push(opset);
        }
        fieldsRead += 1;
        continue;
      }
      if (
        (fieldNumber === 2 || fieldNumber === 3) &&
        byteLength <= MAX_FIELD_BYTES
      ) {
        const payload = reader.readBytes(byteLength);
        if (!payload) {
          break;
        }
        if (fieldNumber === 2) {
          result.producerName = payload.toString("utf-8");
        } else {
          result.producerVersion = payload.toString("utf-8");
        }
        fieldsRead += 1;
        continue;
      }
      // Skip anything else (notably the graph) by offset.
      if (!reader.skip(byteLength)) {
        break;
      }
      fieldsRead += 1;
    }
    // A real ModelProto always carries at least an ir_version; zero consumed
    // fields means the file is not an ONNX model at all.
    if (fieldsRead === 0) {
      return undefined;
    }
    return result;
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) {
      closeSync(fd);
    }
  }
}

/**
 * Reader that fetches bytes from a file descriptor by absolute offset.
 *
 * @param {number} fd Open file descriptor
 * @param {number} fileSize Total file size
 */
class OffsetReader {
  constructor(fd, fileSize) {
    this.fd = fd;
    this.fileSize = fileSize;
    this.offset = 0;
    this.buffer = Buffer.alloc(16);
  }

  /**
   * Read a protobuf varint at the cursor.
   *
   * @returns {bigint|undefined} Value, or undefined at end of input
   */
  readVarint() {
    let result = 0n;
    let shift = 0n;
    for (let i = 0; i < 10; i += 1) {
      if (!this.fillBuffer(1)) {
        return undefined;
      }
      const byte = this.buffer[0];
      this.offset += 1;
      result |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) {
        return result;
      }
      shift += 7n;
    }
    return undefined;
  }

  /**
   * Read a length-delimited payload at the cursor.
   *
   * @param {number} length Payload length
   * @returns {Buffer|undefined} Payload, or undefined when unavailable
   */
  readBytes(length) {
    const payload = Buffer.alloc(length);
    const bytesRead = readSync(this.fd, payload, 0, length, this.offset);
    if (bytesRead !== length) {
      return undefined;
    }
    this.offset += length;
    return payload;
  }

  /**
   * Advance the cursor without reading the payload.
   *
   * @param {number} length Bytes to skip
   * @returns {boolean} true when the skip stayed within the file
   */
  skip(length) {
    const next = this.offset + length;
    if (next > this.fileSize) {
      return false;
    }
    this.offset = next;
    return true;
  }

  /**
   * Ensure up to `length` bytes are available in the scratch buffer.
   *
   * @param {number} length Bytes needed
   * @returns {boolean} true when the read succeeded
   */
  fillBuffer(length) {
    if (this.offset + length > this.fileSize) {
      return false;
    }
    const bytesRead = readSync(this.fd, this.buffer, 0, length, this.offset);
    return bytesRead === length;
  }
}

/**
 * Parse one OperatorSetIdProto payload.
 *
 * @param {Buffer} payload Field payload
 * @returns {{domain: string, version: number}|undefined} Parsed entry
 */
function parseOperatorSetEntry(payload) {
  let pos = 0;
  let domain = "";
  let version = 0;
  while (pos < payload.length) {
    const tag = readVarintFrom(payload, pos);
    if (!tag) {
      break;
    }
    pos = tag.next;
    const fieldNumber = Number(tag.value >> 3n);
    const wireType = Number(tag.value & 7n);
    if (wireType === 0) {
      const value = readVarintFrom(payload, pos);
      if (!value) {
        break;
      }
      pos = value.next;
      if (fieldNumber === 2) {
        version = Number(value.value);
      }
    } else if (wireType === 2) {
      const length = readVarintFrom(payload, pos);
      if (!length) {
        break;
      }
      pos = length.next;
      const byteLength = Number(length.value);
      if (pos + byteLength > payload.length) {
        break;
      }
      if (fieldNumber === 1) {
        domain = payload.toString("utf-8", pos, pos + byteLength);
      }
      pos += byteLength;
    } else {
      break;
    }
  }
  return { domain, version };
}

/**
 * Read a varint from a buffer at a position.
 *
 * @param {Buffer} buffer Source buffer
 * @param {number} pos Start position
 * @returns {{value: bigint, next: number}|undefined} Result, or undefined
 */
function readVarintFrom(buffer, pos) {
  let value = 0n;
  let shift = 0n;
  let cursor = pos;
  for (let i = 0; i < 10 && cursor < buffer.length; i += 1) {
    const byte = buffer[cursor];
    cursor += 1;
    value |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      return { value, next: cursor };
    }
    shift += 7n;
  }
  return undefined;
}
