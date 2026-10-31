import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

function makeCrcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}

const CRC_TABLE = makeCrcTable();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0; // Filter type 0 (None)
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }
  const compressed = zlib.deflateSync(raw, { level: 9 });

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function sdRoundedBox(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - hw + r;
  const qy = Math.abs(py - cy) - hh + r;
  const out = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inside = Math.min(Math.max(qx, qy), 0);
  return out + inside - r;
}

function blendPixel(buf, idx, r, g, b, alpha) {
  const a = clamp01(alpha);
  if (a <= 0) return;
  const dstA = buf[idx + 3] / 255;
  const outA = a + dstA * (1 - a);
  if (outA <= 0) return;
  buf[idx] = Math.round((r * a + buf[idx] * dstA * (1 - a)) / outA);
  buf[idx + 1] = Math.round((g * a + buf[idx + 1] * dstA * (1 - a)) / outA);
  buf[idx + 2] = Math.round((b * a + buf[idx + 2] * dstA * (1 - a)) / outA);
  buf[idx + 3] = Math.round(outA * 255);
}

/**
 * Vẽ biểu tượng "Sổ Bếp Nhà Mình" sắc nét (Bát cơm nóng bốc khói vàng ấm trên nền xanh cổ vịt)
 * ở độ phân giải tùy chọn (hỗ trợ cả chuẩn any lẫn maskable safe-zone).
 */
function renderSoBepIcon(size, { maskable = false } = {}) {
  const rgba = Buffer.alloc(size * size * 4, 0);
  const scale = maskable ? 0.8 : 1.0;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      // Quy đổi sang hệ tọa độ 0..120 giống favicon.svg
      const uRaw = ((x + 0.5) / size) * 120;
      const vRaw = ((y + 0.5) / size) * 120;

      // Nền ngoài (full bleed nếu maskable, bo góc nếu standard)
      if (maskable) {
        rgba[idx] = 15;
        rgba[idx + 1] = 118;
        rgba[idx + 2] = 110;
        rgba[idx + 3] = 255;
      } else {
        const dBg = sdRoundedBox(uRaw, vRaw, 60, 60, 58, 58, 26);
        const aaBg = clamp01(0.8 - dBg);
        blendPixel(rgba, idx, 15, 118, 110, aaBg); // #0f766e
      }

      // Co giãn phần biểu tượng bên trong khi là maskable (safe-zone 80%)
      const u = (uRaw - 60) / scale + 60;
      const v = (vRaw - 60) / scale + 60;

      // 1. Nắm cơm trắng kem nhô tròn phía trên miệng bát (#fffbeb)
      const dRice = Math.hypot((u - 60) * 0.82, (v - 58) * 1.25) - 22;
      if (dRice < 1) {
        blendPixel(rgba, idx, 255, 251, 235, clamp01(0.75 - dRice));
      }

      // 2. Thân bát cơm (#fef3c7)
      let dBowl;
      if (v < 62) {
        dBowl = 62 - v;
      } else if (v <= 78) {
        dBowl = Math.abs(u - 60) - 28;
      } else {
        // Đáy bo tròn bán kính 20 từ y=78..98
        const qx = Math.max(Math.abs(u - 60) - 8, 0);
        const qy = v - 78;
        dBowl = Math.hypot(qx, qy) - 20;
      }
      if (v >= 61 && v <= 100 && Math.abs(u - 60) <= 30) {
        blendPixel(rgba, idx, 254, 243, 199, clamp01(0.8 - dBowl));
      }

      // 3. Đế bát vàng hổ phách (#f59e0b)
      const dFoot = sdRoundedBox(u, v, 60, 99, 13, 3.2, 2.5);
      if (dFoot < 1) {
        blendPixel(rgba, idx, 245, 158, 11, clamp01(0.8 - dFoot));
      }

      // 4. Vành bát vàng sáng (#fbbf24)
      const dRim = sdRoundedBox(u, v, 60, 58, 34, 5.2, 5);
      if (dRim < 1) {
        blendPixel(rgba, idx, 251, 191, 36, clamp01(0.8 - dRim));
      }

      // 5. Ba làn khói ấm bốc lên (#fde68a)
      for (const steamX of [44, 60, 76]) {
        if (v >= 23 && v <= 44) {
          const wave = Math.sin(((v - 24) / 20) * Math.PI * 1.5) * 2.6;
          const dist = Math.hypot(u - (steamX + wave), 0) - 2.6;
          // Bo tròn 2 đầu làn khói
          const capDist =
            v < 25.5
              ? Math.hypot(u - (steamX + wave), v - 25.5) - 2.6
              : v > 41.5
              ? Math.hypot(u - (steamX + wave), v - 41.5) - 2.6
              : dist;
          if (capDist < 1) {
            blendPixel(rgba, idx, 253, 230, 138, clamp01(0.8 - capDist));
          }
        }
      }
    }
  }

  return encodePng(size, size, rgba);
}

const publicDir = path.join(process.cwd(), 'public');
fs.mkdirSync(publicDir, { recursive: true });

const specs = [
  { file: 'pwa-192x192.png', size: 192, maskable: false },
  { file: 'pwa-512x512.png', size: 512, maskable: false },
  { file: 'pwa-maskable-512x512.png', size: 512, maskable: true },
  { file: 'apple-touch-icon.png', size: 180, maskable: true },
];

for (const s of specs) {
  const outPath = path.join(publicDir, s.file);
  const png = renderSoBepIcon(s.size, { maskable: s.maskable });
  fs.writeFileSync(outPath, png);
  console.log(`Generated ${s.file} (${png.length} bytes)`);
}
