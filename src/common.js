import BufferList from 'bl';
import { TextDecoder } from 'text-encoding';
import { DOMParser } from '@xmldom/xmldom';
import ripemd128 from './ripemd128';

const REGEXP_STRIPKEY = {
  mdx: /[()., '/\\@_-]()/g,
  mdd: /([.][^.]*$)|[()., '/\\@_-]/g, // strip '.' before file extension that is keeping the last period
};

const UTF_16LE_DECODER = new TextDecoder('utf-16le');
const UTF16 = 'UTF-16';

function newUint8Array(buf, offset, len) {
  let ret = new Uint8Array(len);
  ret = Buffer.from(buf, offset, offset + len);
  return ret;
}

function readUTF16(buf, offset, length) {
  return UTF_16LE_DECODER.decode(newUint8Array(buf, offset, length));
}

function getExtension(filename, defaultExt) {
  return /(?:\.([^.]+))?$/.exec(filename)[1] || defaultExt;
}

// tool function for levenshtein disttance
function triple_min(a, b, c) {
  const temp = a < b ? a : b;
  return temp < c ? temp : c;
}

// Damerau–Levenshtein distance  implemention
// ref: https://en.wikipedia.org/wiki/Damerau%E2%80%93Levenshtein_distance
function levenshtein_distance(a, b) {
  if (!a || a == undefined) {
    return 9999;
  }
  if (!b || b == undefined) {
    return 9999;
  }
  // create a 2 dimensions array
  const m = a.length;
  const n = b.length;
  const dp = new Array(m + 1);
  for (let i = 0; i <= m; i++) {
    dp[i] = new Array(n + 1);
  }

  // init dp array
  for (let i = 0; i <= m; i++) {
    dp[i][0] = i;
  }
  for (let j = 0; j <= n; j++) {
    dp[0][j] = j;
  }

  // dynamic approach
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] !== b[j - 1]) {
        dp[i][j] = triple_min(
          1 + dp[i - 1][j], // deletion
          1 + dp[i][j - 1], // insertion
          1 + dp[i - 1][j - 1] // replacement
        );
      } else {
        dp[i][j] = dp[i - 1][j - 1];
      }
    }
  }
  return dp[m][n];
}

/**
 * parse mdd/mdx header section
 * @param {string} header_text
 */
function parseHeader(header_text) {
  const doc = new DOMParser().parseFromString(header_text, 'text/xml');
  const header_attr = {};
  let elem = doc.getElementsByTagName('Dictionary')[0];
  if (!elem) {
    elem = doc.getElementsByTagName('Library_Data')[0]; // eslint_disable_prefer_destructing
  }
  for (let i = 0, item; i < elem.attributes.length; i++) {
    item = elem.attributes[i];
    header_attr[item.nodeName] = item.nodeValue;
  }
  return header_attr;
}

/**
 * read in uint8BE Bytes return uint8 number
 * @param {Buffer} bytes Big-endian byte buffer
 */
function uint8BEtoNumber(bytes) {
  return bytes[0] & 0xff;
}

/**
 * read in uint16BE Bytes return uint16 number
 * @param {Buffer} bytes Big-endian byte buffer
 */
function uint16BEtoNumber(bytes) {
  let n = 0;
  for (let i = 0; i < 1; i++) {
    n |= bytes[i];
    n <<= 8;
  }
  n |= bytes[1];
  return n;
}

/**
 * read in uint32BE Bytes return uint32 number
 * @param {Buffer} bytes Big-endian byte buffer
 */
function uint32BEtoNumber(bytes) {
  let n = 0;
  for (let i = 0; i < 3; i++) {
    n |= bytes[i];
    n <<= 8;
  }
  n |= bytes[3];
  return n;
}

/**
 * read in uint32BE Bytes return uint32 number
 * @param {Buffer} bytes Big-endian byte buffer
 */
function uint64BEtoNumber(bytes) {
  if (bytes[1] >= 0x20 || bytes[0] > 0) {
    throw new Error(`uint64 larger than 2^53, JS may lost accuracy`);
  }
  let high = 0;
  for (let i = 0; i < 3; i++) {
    high |= bytes[i] & 0xff;
    high <<= 8;
  }
  high |= bytes[3] & 0xff;
  // ignore > 2^53
  high = (high & 0x001fffff) * 0x100000000;
  high += bytes[4] * 0x1000000;
  high += bytes[5] * 0x10000;
  high += bytes[6] * 0x100;
  high += bytes[7] & 0xff;

  return high;
}

const NUMFMT_UINT8 = Symbol('NUM_FMT_UINT8');
const NUMFMT_UINT16 = Symbol('NUM_FMT_UINT16');
const NUMFMT_UINT32 = Symbol('NUM_FMT_UINT32');
const NUMFMT_UINT64 = Symbol('NUM_FMT_UINT64');
/**
 * read number from buffer
 * @param {BufferList} bf number buffer
 * @param {string} numfmt number format
 */
function readNumber(bf, numfmt) {
  const value = new Uint8Array(bf);
  if (numfmt === NUMFMT_UINT32) {
    // uint32
    return uint32BEtoNumber(value);
  } else if (numfmt === NUMFMT_UINT64) {
    // uint64
    return uint64BEtoNumber(value);
  } else if (numfmt === NUMFMT_UINT16) {
    // uint16
    return uint16BEtoNumber(value);
  } else if (numfmt === NUMFMT_UINT8) {
    // uint8
    return uint8BEtoNumber(value);
  }
  return 0;

  // return struct.unpack(this._number_format, bf)[0];
}

// use BufferList interface to read number
function readNumber2(bf, offset, numfmt) {
  if (numfmt === NUMFMT_UINT32) {
    // uint32
    return bf.readUInt32BE(offset)
    // return uint32BEtoNumber(value);
  } else if (numfmt === NUMFMT_UINT64) {
    // uint64
    return uint64BEtoNumber(bf.slice(offset, offset + 8));
    // return bf.readBigInt64BE(offset)
  } else if (numfmt === NUMFMT_UINT16) {
    // uint16
    // return uint16BEtoNumber(value);
    return bf.readUint16BE(offset)
  } else if (numfmt === NUMFMT_UINT8) {
    // uint8
    return bf.readUInt8(offset)
  }
  return 0;
}

/**
 * fast_decrypt buffer
 * @param {Buffer} data data buffer
 * @param {Buffer} k key
 */
function fast_decrypt(data, k) {
  const b = new Uint8Array(data);
  const key = new Uint8Array(k);
  let previous = 0x36;
  for (let i = 0; i < b.length; ++i) {
    let t = ((b[i] >> 4) | (b[i] << 4)) & 0xff;
    t = t ^ previous ^ (i & 0xff) ^ key[i % key.length];
    previous = b[i];
    b[i] = t;
  }
  return new BufferList(b);
}

/**
 * mdx decrypt method
 * @param {Buffer} comp_block data buffer needs to decrypt
 */
function mdxDecrypt(comp_block) {
  const key = ripemd128.ripemd128(
    new BufferList(comp_block.slice(4, 8))
      .append(Buffer.from([0x95, 0x36, 0x00, 0x00]))
      .slice(0, 8)
  );
  return new BufferList(comp_block.slice(0, 8)).append(
    fast_decrypt(comp_block.slice(8), key)
  );
}

/**
 * Creates a new Uint8Array based on two different ArrayBuffers
 *
 * @param {ArrayBuffers} buffer1 The first buffer.
 * @param {ArrayBuffers} buffer2 The second buffer.
 * @return {ArrayBuffers} The new ArrayBuffer created out of the two.
 */
function appendBuffer(buffer1, buffer2) {
  const tmp = new Uint8Array(buffer1.byteLength + buffer2.byteLength);
  tmp.set(new Uint8Array(buffer1), 0);
  tmp.set(new Uint8Array(buffer2), buffer1.byteLength);
  return tmp.buffer;
}

function wordCompare(word1, word2) {
  if (!word1 || !word2) {
    throw new Error(`invalid word comparation ${word1} and ${word2}`);
  }
  // if the two words are indentical, return 0 directly
  if (word1 === word2) {
    return 0;
  }
  let len = word1.length > word2.length ? word2.length : word1.length;
  for (let i = 0; i < len; i++) {
    let w1 = word1[i];
    let w2 = word2[i];
    if (w1 == w2) {
      continue;
      // case1: w1: `H` w2: `h` or `h` and `H`continue
    } else if (w1.toLowerCase() == w2.toLowerCase()) {
      continue;
      // case3: w1: `H` w2: `k`, h < k return -1
    } else if (w1.toLowerCase() < w2.toLowerCase()) {
      return -1;
      // case4: w1: `H` w2: `a`, h > a return 1
    } else if (w1.toLowerCase() > w2.toLowerCase()) {
      return 1;
    }
  }
  // case5: `Hello` and `Hellocat`
  return word1.length < word2.length ? -1 : 1;
}

// if this.header.KeyCaseSensitive = YES,
// Uppercase character is placed in the start position of the directionary
// so if `this.header.KeyCaseSensitive = YES` use normalUpperCaseWordCompare, else use wordCompare
function normalUpperCaseWordCompare(word1, word2) {
  if (word1 === word2) {
    return 0;
  } else if (word1 > word2) {
    return 1;
  } else {
    return -1;
  }
}

// this compare function is for mdd file
function localCompare(word1, word2) {
  // return word1.localeCompare(word2);
  if (word1.localeCompare(word2) === 0) {
    return 0;
  } else if (word1 > word2) {
    return 1;
  } else {
    return -1;
  }
}

/**
 * Test if a value of dictionary attribute is true or not.
 * ref: https://github.com/fengdh/mdict-js/blob/efc3fa368edd6e57de229375e2b73bbfe189e6ee/mdict-parser.js:235
 */
function isTrue(v) {
  if (!v) return false;
  v = v.toLowerCase();
  return v === 'yes' || v === 'true';
}

export default {
  getExtension,
  readUTF16,
  newUint8Array,
  REGEXP_STRIPKEY,
  UTF16,
  levenshtein_distance,
  parseHeader,
  readNumber,
  readNumber2,
  mdxDecrypt,
  appendBuffer,
  wordCompare,
  normalUpperCaseWordCompare,
  localCompare,
  isTrue,
  NUMFMT_UINT8,
  NUMFMT_UINT16,
  NUMFMT_UINT32,
  NUMFMT_UINT64,
};
