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
const wordmarkSvgPath = resolve(desktopRoot, '..', '..', 'assets', 'pMusic-wordmark.svg');
const wordmarkDataUri = existsSync(wordmarkSvgPath)
  ? `data:image/svg+xml;base64,${Buffer.from(
      readFileSync(wordmarkSvgPath, 'utf-8').replace(/currentColor/g, '#FFFFFF'),
      'utf-8'
    ).toString('base64')}`
  : '';

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

  // 2. Render 164x314 NSIS Welcome/Finish Sidebar BMP (100% custom pMusic Original bubbly aesthetic)
  const sidebarRgba = await page.evaluate(async ({ src, wmSrc }) => {
    const W = 164;
    const H = 314;
    const img = new Image();
    img.src = src;
    await img.decode();
    let wmImg = null;
    if (wmSrc) {
      wmImg = new Image();
      wmImg.src = wmSrc;
      await wmImg.decode();
    }

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

    // Pure obsidian dark base
    const baseGrad = ctx.createLinearGradient(0, 0, W, H);
    baseGrad.addColorStop(0, '#050508');
    baseGrad.addColorStop(0.55, '#0F0B14');
    baseGrad.addColorStop(1, '#07070A');
    ctx.fillStyle = baseGrad;
    ctx.fillRect(0, 0, W, H);

    // Subtle crimson-white ambient glow behind puffy card
    const g1 = ctx.createRadialGradient(W * 0.5, 96, 8, W * 0.5, 96, 114);
    g1.addColorStop(0, 'rgba(250, 35, 59, 0.28)');
    g1.addColorStop(0.55, 'rgba(255, 255, 255, 0.08)');
    g1.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = g1;
    ctx.fillRect(0, 0, W, H);

    // Puffy balloon emblem card
    roundRect(14, 24, 136, 206, 28);
    const cardGrad = ctx.createLinearGradient(14, 24, 150, 230);
    cardGrad.addColorStop(0, 'rgba(255, 255, 255, 0.11)');
    cardGrad.addColorStop(1, 'rgba(255, 255, 255, 0.03)');
    ctx.fillStyle = cardGrad;
    ctx.fill();
    ctx.lineWidth = 1.25;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.stroke();

    // Puffy top gloss highlight
    const rimGrad = ctx.createLinearGradient(30, 25, 134, 25);
    rimGrad.addColorStop(0, 'rgba(255,255,255,0)');
    rimGrad.addColorStop(0.5, 'rgba(255,255,255,0.5)');
    rimGrad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.strokeStyle = rimGrad;
    ctx.beginPath();
    ctx.moveTo(32, 25.5);
    ctx.lineTo(132, 25.5);
    ctx.stroke();

    // New black-squircle "p" app icon
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.65)';
    ctx.shadowBlur = 16;
    ctx.drawImage(img, 39, 44, 86, 86);
    ctx.restore();

    // New vectorized bubbly "pMusic" wordmark
    if (wmImg) {
      const wmW = 104;
      const wmH = Math.round((wmW * wmImg.height) / wmImg.width);
      ctx.drawImage(wmImg, (W - wmW) / 2, 142, wmW, wmH);
    } else {
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '800 22px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('pMusic', W / 2, 156);
    }

    // Puffy version pill
    roundRect(45, 188, 74, 24, 12);
    ctx.fillStyle = 'rgba(250, 35, 59, 0.22)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(250, 35, 59, 0.55)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = '#FFD7DD';
    ctx.font = '700 10.5px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('v0.14.1', W / 2, 200);

    // Puffy sound-wave pills near footer
    const bars = [10, 18, 28, 16, 24, 32, 20, 14, 22, 12];
    const barW = 5;
    const gap = 4.5;
    const totalBarW = bars.length * barW + (bars.length - 1) * gap;
    const startX = (W - totalBarW) / 2;
    for (let i = 0; i < bars.length; i++) {
      const bh = bars[i];
      const bx = startX + i * (barW + gap);
      const by = 266 - bh / 2;
      roundRect(bx, by, barW, bh, 2.5);
      ctx.fillStyle = i % 3 === 1 ? 'rgba(250, 35, 59, 0.8)' : 'rgba(255, 255, 255, 0.32)';
      ctx.fill();
    }

    ctx.fillStyle = 'rgba(255, 255, 255, 0.68)';
    ctx.font = '600 9.5px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('pMusic Original · Hi-Fi', W / 2, 296);

    return Array.from(ctx.getImageData(0, 0, W, H).data);
  }, { src: iconDataUri, wmSrc: wordmarkDataUri });

  const sidebarPath = resolve(buildDir, 'installerSidebar.bmp');
  writeFileSync(sidebarPath, encode24BitBmp(164, 314, Uint8Array.from(sidebarRgba)));

  // 3. Render sleek 150x57 NSIS Header BMP with new p icon + bubbly pMusic wordmark
  const headerRgba = await page.evaluate(async ({ src, wmSrc }) => {
    const W = 150;
    const H = 57;
    const img = new Image();
    img.src = src;
    await img.decode();
    let wmImg = null;
    if (wmSrc) {
      wmImg = new Image();
      wmImg.src = wmSrc;
      await wmImg.decode();
    }

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

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, W, H);

    // Puffy dark pill inside header
    roundRect(6, 6, W - 12, H - 12, 16);
    const pillGrad = ctx.createLinearGradient(6, 6, W - 6, H - 6);
    pillGrad.addColorStop(0, '#08080C');
    pillGrad.addColorStop(1, '#19101A');
    ctx.fillStyle = pillGrad;
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = 'rgba(250, 35, 59, 0.45)';
    ctx.stroke();

    ctx.drawImage(img, 14, 12.5, 32, 32);

    if (wmImg) {
      const wmW = 82;
      const wmH = Math.round((wmW * wmImg.height) / wmImg.width);
      ctx.drawImage(wmImg, 52, Math.round((H - wmH) / 2), wmW, wmH);
    } else {
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '800 15px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('pMusic', 54, 28);
    }

    return Array.from(ctx.getImageData(0, 0, W, H).data);
  }, { src: iconDataUri, wmSrc: wordmarkDataUri });

  const headerPath = resolve(buildDir, 'installerHeader.bmp');
  writeFileSync(headerPath, encode24BitBmp(150, 57, Uint8Array.from(headerRgba)));

  // 4. Render 420x260 Ultra-Minimalist pMusic Monochrome Portable Splash BMP (zero text, zero red)
  const splashRgba = await page.evaluate(async ({ src, wmSrc }) => {
    const W = 420;
    const H = 260;
    const img = new Image();
    img.src = src;
    await img.decode();
    let wmImg = null;
    if (wmSrc) {
      wmImg = new Image();
      wmImg.src = wmSrc;
      await wmImg.decode();
    }

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#050507';
    ctx.fillRect(0, 0, W, H);

    // Soft monochrome silver aura
    const glow = ctx.createRadialGradient(W / 2, 92, 10, W / 2, 92, 170);
    glow.addColorStop(0, 'rgba(255, 255, 255, 0.13)');
    glow.addColorStop(0.55, 'rgba(200, 210, 230, 0.04)');
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    // Subtle hairline border
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, W - 2, H - 2);

    // Centered p icon
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 24;
    ctx.drawImage(img, (W - 86) / 2, 42, 86, 86);
    ctx.restore();

    // Pure white pMusic wordmark
    if (wmImg) {
      const wmW = 122;
      const wmH = Math.round((wmW * wmImg.height) / wmImg.width);
      ctx.drawImage(wmImg, (W - wmW) / 2, 144, wmW, wmH);
    }

    // Minimal monochrome loading line
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect((W - 150) / 2, 212, 150, 2.5);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect((W - 150) / 2, 212, 68, 2.5);

    return Array.from(ctx.getImageData(0, 0, W, H).data);
  }, { src: iconDataUri, wmSrc: wordmarkDataUri });

  const splashPath = resolve(buildDir, 'portableSplash.bmp');
  writeFileSync(splashPath, encode24BitBmp(420, 260, Uint8Array.from(splashRgba)));

  console.log(
    `Generated Windows branding assets:\n- ${icoPath} (${statSync(icoPath).size} bytes)\n- ${sidebarPath} (${statSync(sidebarPath).size} bytes)\n- ${headerPath} (${statSync(headerPath).size} bytes)\n- ${splashPath} (${statSync(splashPath).size} bytes)`
  );
} finally {
  await browser.close();
}
