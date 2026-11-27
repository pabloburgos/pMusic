import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { deflateRawSync } from 'node:zlib';

const repoRoot = resolve(import.meta.dirname, '..');
const webDistDir = resolve(repoRoot, 'apps/web/dist');
const desktopPkgPath = resolve(repoRoot, 'apps/desktop/package.json');
const outDir = resolve(repoRoot, 'ota');
const zipPath = resolve(outDir, 'pMusic-web-bundle.zip');
const manifestPath = resolve(outDir, 'latest.json');

if (!existsSync(resolve(webDistDir, 'index.html'))) {
  throw new Error('No existe apps/web/dist/index.html. Ejecuta npm run build:web antes de build-ota-bundle.');
}

const desktopPkg = JSON.parse(readFileSync(desktopPkgPath, 'utf-8'));
const version = String(desktopPkg.version ?? '0.23.2').trim().replace(/^v/i, '');

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[i] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function walkFiles(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walkFiles(full, acc);
    } else {
      acc.push(full);
    }
  }
  return acc;
}

function createZipBuffer(rootDir) {
  const files = walkFiles(rootDir).sort();
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;

  for (const absPath of files) {
    const relName = relative(rootDir, absPath).replace(/\\/g, '/');
    const nameBuf = Buffer.from(relName, 'utf-8');
    const raw = readFileSync(absPath);
    const deflated = deflateRawSync(raw, { level: 6 });
    const useDeflate = deflated.length < raw.length;
    const comp = useDeflate ? deflated : raw;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(raw);

    const localHdr = Buffer.alloc(30);
    localHdr.writeUInt32LE(0x04034b50, 0);
    localHdr.writeUInt16LE(20, 4);
    localHdr.writeUInt16LE(0x0800, 6);
    localHdr.writeUInt16LE(method, 8);
    localHdr.writeUInt16LE(0, 10);
    localHdr.writeUInt16LE(0x5421, 12);
    localHdr.writeUInt32LE(crc, 14);
    localHdr.writeUInt32LE(comp.length, 18);
    localHdr.writeUInt32LE(raw.length, 22);
    localHdr.writeUInt16LE(nameBuf.length, 26);
    localHdr.writeUInt16LE(0, 28);

    const localRecord = Buffer.concat([localHdr, nameBuf, comp]);
    localChunks.push(localRecord);

    const centralHdr = Buffer.alloc(46);
    centralHdr.writeUInt32LE(0x02014b50, 0);
    centralHdr.writeUInt16LE(20, 4);
    centralHdr.writeUInt16LE(20, 6);
    centralHdr.writeUInt16LE(0x0800, 8);
    centralHdr.writeUInt16LE(method, 10);
    centralHdr.writeUInt16LE(0, 12);
    centralHdr.writeUInt16LE(0x5421, 14);
    centralHdr.writeUInt32LE(crc, 16);
    centralHdr.writeUInt32LE(comp.length, 20);
    centralHdr.writeUInt32LE(raw.length, 24);
    centralHdr.writeUInt16LE(nameBuf.length, 28);
    centralHdr.writeUInt16LE(0, 30);
    centralHdr.writeUInt16LE(0, 32);
    centralHdr.writeUInt16LE(0, 34);
    centralHdr.writeUInt16LE(0, 36);
    centralHdr.writeUInt32LE(0, 38);
    centralHdr.writeUInt32LE(offset, 42);

    centralChunks.push(centralHdr, nameBuf);
    offset += localRecord.length;
  }

  const centralDir = Buffer.concat(centralChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localChunks, centralDir, eocd]);
}

mkdirSync(outDir, { recursive: true });
const zipBuf = createZipBuffer(webDistDir);
writeFileSync(zipPath, zipBuf);

const manifest = {
  version,
  minNativeVersion: '0.24.3',
  bundleUrl: 'https://raw.githubusercontent.com/pabloburgos/pMusic/main/ota/pMusic-web-bundle.zip',
  apkUrl: `https://github.com/pabloburgos/pMusic/releases/download/v${version}/pMusic-Android.apk`,
  exeUrl: `https://github.com/pabloburgos/pMusic/releases/download/v${version}/pMusic-Setup-${version}.exe`,
  sizeBytes: zipBuf.length,
  publishedAt: new Date().toISOString(),
};
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
console.log(`pMusic OTA bundle v${version} generated (${zipBuf.length} bytes) in ota/pMusic-web-bundle.zip`);
