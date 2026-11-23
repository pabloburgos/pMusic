import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(__dirname, '..');
const buildDir = resolve(desktopRoot, 'build');
mkdirSync(buildDir, { recursive: true });

const iconPngPath = resolve(buildDir, 'icon.png');
if (!existsSync(iconPngPath)) {
  throw new Error(`Missing source icon PNG: ${iconPngPath}`);
}

const CHROME_PATH =
  process.env.PMUSIC_CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

/**
 * Encodes RGBA pixel data (top-down) into a classic 32bpp BI_RGB BMP DIB payload
 * suitable for embedding inside a Windows .ico file (BITMAPINFOHEADER + BGRA + 1bpp AND mask).
 */
function encodeIcoBmpDib(width, height, rgba) {
  const andRowStride = Math.ceil(width / 32) * 4;
  const xorSize = width * height * 4;
  const andSize = andRowStride * height;
  const headerSize = 40;
  const buf = Buffer.alloc(headerSize + xorSize + andSize);

  buf.writeUInt32LE(headerSize, 0); // biSize
  buf.writeInt32LE(width, 4); // biWidth
  buf.writeInt32LE(height * 2, 8); // biHeight (XOR + AND)
  buf.writeUInt16LE(1, 12); // biPlanes
  buf.writeUInt16LE(32, 14); // biBitCount
  buf.writeUInt32LE(0, 16); // biCompression (BI_RGB)
  buf.writeUInt32LE(xorSize + andSize, 20); // biSizeImage

  // Bottom-up XOR BGRA pixels
  let pos = headerSize;
  for (let y = height - 1; y >= 0; y--) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      buf[pos++] = rgba[idx + 2]; // B
      buf[pos++] = rgba[idx + 1]; // G
      buf[pos++] = rgba[idx]; // R
      buf[pos++] = rgba[idx + 3]; // A
    }
  }

  // Bottom-up 1bpp AND mask (1 = transparent where alpha < 24)
  for (let y = height - 1; y >= 0; y--) {
    for (let byteIdx = 0; byteIdx < andRowStride; byteIdx++) {
      let b = 0;
      for (let bit = 0; bit < 8; bit++) {
        const x = byteIdx * 8 + bit;
        if (x < width) {
          const a = rgba[(y * width + x) * 4 + 3];
          if (a < 24) b |= 1 << (7 - bit);
        }
      }
      buf[pos++] = b;
    }
  }

  return buf;
}

/**
 * Packs ICO frames into a standard Windows .ico binary.
 */
function encodeIco(entries) {
  const count = entries.length;
  const dirSize = 6 + count * 16;
  const totalBytes = entries.reduce((acc, e) => acc + e.data.length, dirSize);
  const out = Buffer.alloc(totalBytes);

  out.writeUInt16LE(0, 0); // idReserved
  out.writeUInt16LE(1, 2); // idType (1 = ICO)
  out.writeUInt16LE(count, 4); // idCount

  let dataOffset = dirSize;
  for (let i = 0; i < count; i++) {
    const e = entries[i];
    const dirPos = 6 + i * 16;
    out[dirPos] = e.width >= 256 ? 0 : e.width;
    out[dirPos + 1] = e.height >= 256 ? 0 : e.height;
    out[dirPos + 2] = 0; // bColorCount
    out[dirPos + 3] = 0; // bReserved
    out.writeUInt16LE(1, dirPos + 4); // wPlanes
    out.writeUInt16LE(32, dirPos + 6); // wBitCount
    out.writeUInt32LE(e.data.length, dirPos + 8); // dwBytesInRes
    out.writeUInt32LE(dataOffset, dirPos + 12); // dwImageOffset
    e.data.copy(out, dataOffset);
    dataOffset += e.data.length;
  }
  return out;
}

/**
 * Encodes top-down RGBA pixels onto a white background as an uncompressed 24-bit BI_RGB BMP
 * strictly required by NSIS MUI2 header/sidebar controls.
 */
function encode24BitBmp(width, height, rgba) {
  const rowStride = Math.ceil((width * 3) / 4) * 4;
  const pixelArraySize = rowStride * height;
  const headerSize = 14 + 40;
  const out = Buffer.alloc(headerSize + pixelArraySize);

  // BITMAPFILEHEADER (14 bytes)
  out.write('BM', 0, 'ascii');
  out.writeUInt32LE(headerSize + pixelArraySize, 2);
  out.writeUInt32LE(0, 6);
  out.writeUInt32LE(headerSize, 10);

  // BITMAPINFOHEADER (40 bytes)
  out.writeUInt32LE(40, 14);
  out.writeInt32LE(width, 18);
  out.writeInt32LE(height, 22); // positive = bottom-up
  out.writeUInt16LE(1, 26); // biPlanes
  out.writeUInt16LE(24, 28); // biBitCount
  out.writeUInt32LE(0, 30); // biCompression = BI_RGB
  out.writeUInt32LE(pixelArraySize, 34);
  out.writeInt32LE(2835, 38); // ~72 DPI X
  out.writeInt32LE(2835, 42); // ~72 DPI Y

  let pos = headerSize;
  for (let y = height - 1; y >= 0; y--) {
    let rowPos = pos;
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const a = rgba[idx + 3] / 255;
      const r = Math.round(rgba[idx] * a + 255 * (1 - a));
      const g = Math.round(rgba[idx + 1] * a + 255 * (1 - a));
      const b = Math.round(rgba[idx + 2] * a + 255 * (1 - a));
      out[rowPos++] = b;
      out[rowPos++] = g;
      out[rowPos++] = r;
    }
    pos += rowStride;
  }

  return out;
}

const iconDataUri = `data:image/png;base64,${readFileSync(iconPngPath).toString('base64')}`;

const browser = await chromium.launch({
  executablePath: existsSync(CHROME_PATH) ? CHROME_PATH : undefined,
  headless: true,
});

try {
  const page = await browser.newPage();

  // 1. Render multi-size icon frames for Windows .ico (16, 24, 32, 48, 64, 128 DIB + 256 PNG)
  const iconFrames = await page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();

    const sizes = [16, 24, 32, 48, 64, 128, 256];
    const results = [];
    for (const size of sizes) {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, size, size);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, size, size);

      if (size === 256) {
        const pngB64 = canvas.toDataURL('image/png').split(',')[1];
        results.push({ size, pngB64 });
      } else {
        const data = Array.from(ctx.getImageData(0, 0, size, size).data);
        results.push({ size, rgba: data });
      }
    }
    return results;
  }, iconDataUri);

  const icoEntries = iconFrames.map((f) => ({
    width: f.size,
    height: f.size,
    data: f.pngB64
      ? Buffer.from(f.pngB64, 'base64')
      : encodeIcoBmpDib(f.size, f.size, Uint8Array.from(f.rgba)),
  }));
  const icoPath = resolve(buildDir, 'icon.ico');
  writeFileSync(icoPath, encodeIco(icoEntries));

  // 2. Render sleek 164x314 Liquid Glass pMusic NSIS Sidebar BMP
  const sidebarRgba = await page.evaluate(async (src) => {
    const W = 164;
    const H = 314;
    const img = new Image();
    img.src = src;
    await img.decode();

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    const roundRect = (x, y, w, h, r) => {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    };

    // Deep obsidian base
    const baseGrad = ctx.createLinearGradient(0, 0, W, H);
    baseGrad.addColorStop(0, '#07070D');
    baseGrad.addColorStop(0.55, '#120D22');
    baseGrad.addColorStop(1, '#090910');
    ctx.fillStyle = baseGrad;
    ctx.fillRect(0, 0, W, H);

    // Liquid Glass ambient mesh glows
    const g1 = ctx.createRadialGradient(W * 0.5, 96, 8, W * 0.5, 96, 118);
    g1.addColorStop(0, 'rgba(186, 140, 255, 0.36)');
    g1.addColorStop(0.55, 'rgba(124, 88, 224, 0.14)');
    g1.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = g1;
    ctx.fillRect(0, 0, W, H);

    const g2 = ctx.createRadialGradient(W * 0.25, H - 34, 4, W * 0.25, H - 34, 96);
    g2.addColorStop(0, 'rgba(92, 168, 255, 0.20)');
    g2.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, W, H);

    // Central frosted Liquid Glass emblem card
    roundRect(16, 30, 132, 198, 22);
    const cardGrad = ctx.createLinearGradient(16, 30, 148, 228);
    cardGrad.addColorStop(0, 'rgba(255, 255, 255, 0.095)');
    cardGrad.addColorStop(1, 'rgba(255, 255, 255, 0.03)');
    ctx.fillStyle = cardGrad;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.stroke();

    // Specular top caustic rim
    const rimGrad = ctx.createLinearGradient(28, 30, 136, 30);
    rimGrad.addColorStop(0, 'rgba(255,255,255,0)');
    rimGrad.addColorStop(0.5, 'rgba(255,255,255,0.45)');
    rimGrad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.strokeStyle = rimGrad;
    ctx.beginPath();
    ctx.moveTo(30, 31);
    ctx.lineTo(134, 31);
    ctx.stroke();

    // pMusic Icon with subtle glow
    ctx.save();
    ctx.shadowColor = 'rgba(226, 204, 255, 0.32)';
    ctx.shadowBlur = 18;
    ctx.drawImage(img, 41, 50, 82, 82);
    ctx.restore();

    // Brand wordmark
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 23px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('pMusic', W / 2, 156);

    // Frosted version pill
    roundRect(45, 178, 74, 22, 11);
    ctx.fillStyle = 'rgba(226, 204, 255, 0.15)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(226, 204, 255, 0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = '#E8D8FF';
    ctx.font = '600 10.5px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('v0.12.0', W / 2, 189.5);

    // Acoustic wave decorative bars near footer
    const bars = [10, 18, 28, 16, 24, 32, 20, 14, 22, 12];
    const barW = 4;
    const gap = 5;
    const totalBarW = bars.length * barW + (bars.length - 1) * gap;
    const startX = (W - totalBarW) / 2;
    for (let i = 0; i < bars.length; i++) {
      const bh = bars[i];
      const bx = startX + i * (barW + gap);
      const by = 266 - bh / 2;
      roundRect(bx, by, barW, bh, 2);
      ctx.fillStyle = i % 3 === 1 ? 'rgba(226, 204, 255, 0.65)' : 'rgba(255, 255, 255, 0.28)';
      ctx.fill();
    }

    ctx.fillStyle = 'rgba(255, 255, 255, 0.62)';
    ctx.font = '500 9.5px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('Liquid Glass · AutoMix DJ', W / 2, 294);

    return Array.from(ctx.getImageData(0, 0, W, H).data);
  }, iconDataUri);

  const sidebarPath = resolve(buildDir, 'installerSidebar.bmp');
  writeFileSync(sidebarPath, encode24BitBmp(164, 314, Uint8Array.from(sidebarRgba)));

  // 3. Render sleek 150x57 NSIS Header BMP (seamless #FFFFFF outer canvas + dark Liquid Glass pill)
  const headerRgba = await page.evaluate(async (src) => {
    const W = 150;
    const H = 57;
    const img = new Image();
    img.src = src;
    await img.decode();

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    const roundRect = (x, y, w, h, r) => {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    };

    // Match Windows MUI header surface on edges
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, W, H);

    // Floating dark obsidian Liquid Glass pill inside header
    roundRect(8, 7, W - 16, H - 14, 13);
    const pillGrad = ctx.createLinearGradient(8, 7, W - 8, H - 7);
    pillGrad.addColorStop(0, '#101018');
    pillGrad.addColorStop(1, '#1D1533');
    ctx.fillStyle = pillGrad;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#D5C7F2';
    ctx.stroke();

    ctx.drawImage(img, 17, 13.5, 30, 30);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 15px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('pMusic', 54, 24);

    ctx.fillStyle = '#DFC8FF';
    ctx.font = '600 9.5px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('PRO AUDIO', 54, 38);

    return Array.from(ctx.getImageData(0, 0, W, H).data);
  }, iconDataUri);

  const headerPath = resolve(buildDir, 'installerHeader.bmp');
  writeFileSync(headerPath, encode24BitBmp(150, 57, Uint8Array.from(headerRgba)));

  console.log(
    `Generated Windows branding assets:\n- ${icoPath} (${statSync(icoPath).size} bytes)\n- ${sidebarPath} (${statSync(sidebarPath).size} bytes)\n- ${headerPath} (${statSync(headerPath).size} bytes)`
  );
} finally {
  await browser.close();
}
