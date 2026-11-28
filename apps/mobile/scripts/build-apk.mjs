import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const mobileRoot = resolve(__dirname, '..');
const webDist = resolve(mobileRoot, '../web/dist');
const apkOutputDir = resolve(mobileRoot, 'android/app/build/outputs/apk/debug');
const apkOutputPath = resolve(apkOutputDir, 'app-debug.apk');
const apkNamedOutputPath = resolve(apkOutputDir, 'pMusic-Android.apk');

function resolveAndroidSdk() {
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    'C:\\Users\\pable\\AppData\\Local\\Android\\Sdk',
    '/opt/android-sdk',
  ].filter(Boolean);
  for (const cand of candidates) {
    if (existsSync(cand)) return cand;
  }
  throw new Error('Android SDK not found');
}

const ANDROID_SDK = resolveAndroidSdk();
const buildToolsRoot = resolve(ANDROID_SDK, 'build-tools');
const buildToolVersions = readdirSync(buildToolsRoot).sort().reverse();
const BUILD_TOOLS = resolve(buildToolsRoot, buildToolVersions[0]);

const platformsRoot = resolve(ANDROID_SDK, 'platforms');
const platformVersions = readdirSync(platformsRoot).sort().reverse();
const PLATFORM_JAR = resolve(platformsRoot, platformVersions[0], 'android.jar');

const isWin = process.platform === 'win32';
const AAPT2 = resolve(BUILD_TOOLS, isWin ? 'aapt2.exe' : 'aapt2');
const ZIPALIGN = resolve(BUILD_TOOLS, isWin ? 'zipalign.exe' : 'zipalign');
const D8_JAR = resolve(BUILD_TOOLS, 'lib/d8.jar');
const APKSIGNER_JAR = resolve(BUILD_TOOLS, 'lib/apksigner.jar');

const workDir = resolve(mobileRoot, 'android/app/build/real-apk-work');
rmSync(workDir, { recursive: true, force: true });
mkdirSync(workDir, { recursive: true });
mkdirSync(apkOutputDir, { recursive: true });

const resDir = resolve(workDir, 'res');
const valuesDir = resolve(resDir, 'values');
const drawableDir = resolve(resDir, 'drawable');
const xmlDir = resolve(resDir, 'xml');
const xmlV31Dir = resolve(resDir, 'xml-v31');
const layoutDir = resolve(resDir, 'layout');
const assetsPublicDir = resolve(workDir, 'assets/public');
const javaSrcDir = resolve(workDir, 'java/es/pmusic/app');
const classesDir = resolve(workDir, 'classes');
const dexDir = resolve(workDir, 'dex');

mkdirSync(valuesDir, { recursive: true });
mkdirSync(drawableDir, { recursive: true });
mkdirSync(xmlDir, { recursive: true });
mkdirSync(xmlV31Dir, { recursive: true });
mkdirSync(layoutDir, { recursive: true });
mkdirSync(assetsPublicDir, { recursive: true });
mkdirSync(javaSrcDir, { recursive: true });
mkdirSync(classesDir, { recursive: true });
mkdirSync(dexDir, { recursive: true });

// 1. Copy compiled web UI assets into assets/public
if (existsSync(webDist)) {
  cpSync(webDist, assetsPublicDir, { recursive: true });
}

// 2. Generate valid PNG app icon in res/drawable/ic_launcher.png
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makePngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcVal = crc32(Buffer.concat([typeBuf, data]));
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crcVal, 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function generateIconPng(size = 192) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const rawRows = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + size * 4);
    rawRows[rowStart] = 0;
    for (let x = 0; x < size; x++) {
      const px = rowStart + 1 + x * 4;
      const dx = x - size / 2;
      const dy = y - size / 2;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < size * 0.36 && dist > size * 0.24) {
        rawRows[px] = 245;
        rawRows[px + 1] = 245;
        rawRows[px + 2] = 247;
        rawRows[px + 3] = 255;
      } else {
        rawRows[px] = 8;
        rawRows[px + 1] = 8;
        rawRows[px + 2] = 12;
        rawRows[px + 3] = 255;
      }
    }
  }
  return Buffer.concat([
    sig,
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', deflateSync(rawRows)),
    makePngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function generateNotificationIconPng(size = 96) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const rawRows = Buffer.alloc(size * (1 + size * 4));
  // Pure white silhouette of pMusic "p" loop + play glyph on transparent background (Android Material status icon)
  const cx = size * 0.52;
  const cy = size * 0.41;
  const rOuter = size * 0.30;
  const rInner = size * 0.175;
  const stemL = size * 0.22;
  const stemR = size * 0.345;
  const stemT = size * 0.24;
  const stemB = size * 0.88;
  const pAx = cx - size * 0.055;
  const pAy = cy - size * 0.085;
  const pBx = cx - size * 0.055;
  const pBy = cy + size * 0.085;
  const pCx = cx + size * 0.095;
  const pCy = cy;
  const sign = (ax, ay, bx, by, px, py) => (ax - px) * (by - py) - (bx - px) * (ay - py);

  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + size * 4);
    rawRows[rowStart] = 0;
    for (let x = 0; x < size; x++) {
      const px = rowStart + 1 + x * 4;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const inRing = dist <= rOuter && dist >= rInner;
      const inStem = x >= stemL && x <= stemR && y >= stemT && y <= stemB;
      const d1 = sign(pAx, pAy, pBx, pBy, x, y);
      const d2 = sign(pBx, pBy, pCx, pCy, x, y);
      const d3 = sign(pCx, pCy, pAx, pAy, x, y);
      const inTri = (d1 >= 0 && d2 >= 0 && d3 >= 0) || (d1 <= 0 && d2 <= 0 && d3 <= 0);
      if (inRing || inStem || inTri) {
        rawRows[px] = 255;
        rawRows[px + 1] = 255;
        rawRows[px + 2] = 255;
        rawRows[px + 3] = 255;
      } else {
        rawRows[px] = 0;
        rawRows[px + 1] = 0;
        rawRows[px + 2] = 0;
        rawRows[px + 3] = 0;
      }
    }
  }
  return Buffer.concat([
    sig,
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', deflateSync(rawRows)),
    makePngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const androidBrandIcon = resolve(__dirname, '../../desktop/build/icon-android.png');
if (existsSync(androidBrandIcon)) {
  cpSync(androidBrandIcon, resolve(drawableDir, 'ic_launcher.png'));
} else {
  writeFileSync(resolve(drawableDir, 'ic_launcher.png'), generateIconPng(192));
}

const officialFaviconSvgPath = resolve(__dirname, '../../web/public/favicon.svg');
const officialFaviconSvg = existsSync(officialFaviconSvgPath)
  ? readFileSync(officialFaviconSvgPath, 'utf-8')
  : '';
const pathDataMatch = officialFaviconSvg.match(/d="([^"]+)"/);
const officialPathData = pathDataMatch
  ? pathDataMatch[1]
  : 'M100.6 0.2 C121.0 1.4 139.0 12.1 149.4 29.5 C163.3 52.8 159.4 81.9 140.0 101.2 C127.6 113.5 110.9 120.2 93.4 120.0 L59.0 119.6 L59.0 165.4 C59.0 176.9 49.7 186.2 38.2 186.2 L32.2 186.2 C20.7 186.2 11.4 176.9 11.4 165.4 L11.4 58.6 C11.4 25.1 39.2 -1.9 72.7 0.0 Z M91.4 33.4 C77.1 33.4 65.5 45.0 65.5 59.3 C65.5 73.6 77.1 85.2 91.4 85.2 C105.7 85.2 117.3 73.6 117.3 59.3 C117.3 45.0 105.7 33.4 91.4 33.4 Z';
const icStatVectorXml = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="256"
    android:viewportHeight="256">
    <group
        android:translateX="52.56"
        android:translateY="34.00"
        android:scaleX="0.94"
        android:scaleY="0.94">
        <path
            android:fillColor="#FFFFFFFF"
            android:fillType="evenOdd"
            android:pathData="${officialPathData}" />
    </group>
</vector>
`;
writeFileSync(resolve(drawableDir, 'ic_stat_pmusic.xml'), icStatVectorXml, 'utf-8');

const shuffleOffVectorXml = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:strokeColor="#88FFFFFF"
        android:strokeWidth="2"
        android:strokeLineCap="round"
        android:strokeLineJoin="round"
        android:pathData="M2,18 H5.2 C7.8,18 9.2,15 12,12 C14.8,9 16.2,6 18.8,6 H21.5 M18.5,2.8 L22,6 L18.5,9.2" />
    <path
        android:strokeColor="#88FFFFFF"
        android:strokeWidth="2"
        android:strokeLineCap="round"
        android:strokeLineJoin="round"
        android:pathData="M2,6 H5.2 C7.8,6 9.2,9 12,12 C14.8,15 16.2,18 18.8,18 H21.5 M18.5,14.8 L22,18 L18.5,21.2" />
</vector>
`;
const shuffleOnVectorXml = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:strokeColor="#FFFFFFFF"
        android:strokeWidth="2.1"
        android:strokeLineCap="round"
        android:strokeLineJoin="round"
        android:pathData="M2,18 H5.2 C7.8,18 9.2,15 12,12 C14.8,9 16.2,6 18.8,6 H21.5 M18.5,2.8 L22,6 L18.5,9.2" />
    <path
        android:strokeColor="#FFFFFFFF"
        android:strokeWidth="2.1"
        android:strokeLineCap="round"
        android:strokeLineJoin="round"
        android:pathData="M2,6 H5.2 C7.8,6 9.2,9 12,12 C14.8,15 16.2,18 18.8,18 H21.5 M18.5,14.8 L22,18 L18.5,21.2" />
    <path
        android:fillColor="#FF34D399"
        android:pathData="M12,21.8 m-1.4,0 a1.4,1.4 0 1 1 2.8,0 a1.4,1.4 0 1 1 -2.8,0" />
</vector>
`;
const repeatOffVectorXml = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:strokeColor="#88FFFFFF"
        android:strokeWidth="2"
        android:strokeLineCap="round"
        android:strokeLineJoin="round"
        android:pathData="M17,2 L21,6 L17,10 M3,11 V9 A4,4 0 0 1 7,5 H21" />
    <path
        android:strokeColor="#88FFFFFF"
        android:strokeWidth="2"
        android:strokeLineCap="round"
        android:strokeLineJoin="round"
        android:pathData="M7,22 L3,18 L7,14 M21,13 V15 A4,4 0 0 1 17,19 H3" />
</vector>
`;
const repeatAllVectorXml = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:strokeColor="#FFFFFFFF"
        android:strokeWidth="2.1"
        android:strokeLineCap="round"
        android:strokeLineJoin="round"
        android:pathData="M17,2 L21,6 L17,10 M3,11 V9 A4,4 0 0 1 7,5 H21" />
    <path
        android:strokeColor="#FFFFFFFF"
        android:strokeWidth="2.1"
        android:strokeLineCap="round"
        android:strokeLineJoin="round"
        android:pathData="M7,22 L3,18 L7,14 M21,13 V15 A4,4 0 0 1 17,19 H3" />
    <path
        android:fillColor="#FF34D399"
        android:pathData="M12,22 m-1.4,0 a1.4,1.4 0 1 1 2.8,0 a1.4,1.4 0 1 1 -2.8,0" />
</vector>
`;
const repeatOneVectorXml = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:strokeColor="#FFFFFFFF"
        android:strokeWidth="2.1"
        android:strokeLineCap="round"
        android:strokeLineJoin="round"
        android:pathData="M17,2 L21,6 L17,10 M3,11 V9 A4,4 0 0 1 7,5 H21" />
    <path
        android:strokeColor="#FFFFFFFF"
        android:strokeWidth="2.1"
        android:strokeLineCap="round"
        android:strokeLineJoin="round"
        android:pathData="M7,22 L3,18 L7,14 M21,13 V15 A4,4 0 0 1 17,19 H3" />
    <path
        android:strokeColor="#FF34D399"
        android:strokeWidth="2"
        android:strokeLineCap="round"
        android:strokeLineJoin="round"
        android:pathData="M11,10.5 L12.2,9.5 V14.5" />
</vector>
`;
const mediaPlayVectorXml = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:fillColor="#FFFFFFFF"
        android:pathData="M6.4,3.4 C5.0,2.58 3.4,3.6 3.4,5.2 V18.8 C3.4,20.4 5.0,21.42 6.4,20.6 L19.4,13.8 C20.85,13.04 20.85,10.96 19.4,10.2 L6.4,3.4 Z" />
</vector>
`;
const mediaPauseVectorXml = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:fillColor="#FFFFFFFF"
        android:pathData="M7.4,3 C8.946,3 10.2,4.254 10.2,5.8 V18.2 C10.2,19.746 8.946,21 7.4,21 C5.854,21 4.6,19.746 4.6,18.2 V5.8 C4.6,4.254 5.854,3 7.4,3 Z M16.6,3 C18.146,3 19.4,4.254 19.4,5.8 V18.2 C19.4,19.746 18.146,21 16.6,21 C15.054,21 13.8,19.746 13.8,18.2 V5.8 C13.8,4.254 15.054,3 16.6,3 Z" />
</vector>
`;
const mediaNextVectorXml = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:fillColor="#FFFFFFFF"
        android:pathData="M4.8,4.4 C3.7,3.72 2.4,4.52 2.4,5.82 V18.18 C2.4,19.48 3.7,20.28 4.8,19.6 L14.8,13.42 C15.88,12.76 15.88,11.24 14.8,10.58 L4.8,4.4 Z M19.4,4.2 C20.284,4.2 21.0,4.916 21.0,5.8 V18.2 C21.0,19.084 20.284,19.8 19.4,19.8 C18.516,19.8 17.8,19.084 17.8,18.2 V5.8 C17.8,4.916 18.516,4.2 19.4,4.2 Z" />
</vector>
`;
const mediaPrevVectorXml = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:fillColor="#FFFFFFFF"
        android:pathData="M4.6,4.2 C5.484,4.2 6.2,4.916 6.2,5.8 V18.2 C6.2,19.084 5.484,19.8 4.6,19.8 C3.716,19.8 3.0,19.084 3.0,18.2 V5.8 C3.0,4.916 3.716,4.2 4.6,4.2 Z M19.2,4.4 C20.3,3.72 21.6,4.52 21.6,5.82 V18.18 C21.6,19.48 20.3,20.28 19.2,19.6 L9.2,13.42 C8.12,12.76 8.12,11.24 9.2,10.58 L19.2,4.4 Z" />
</vector>
`;
writeFileSync(resolve(drawableDir, 'ic_media_shuffle_off.xml'), shuffleOffVectorXml, 'utf-8');
writeFileSync(resolve(drawableDir, 'ic_media_shuffle_on.xml'), shuffleOnVectorXml, 'utf-8');
writeFileSync(resolve(drawableDir, 'ic_media_repeat_off.xml'), repeatOffVectorXml, 'utf-8');
writeFileSync(resolve(drawableDir, 'ic_media_repeat_all.xml'), repeatAllVectorXml, 'utf-8');
writeFileSync(resolve(drawableDir, 'ic_media_repeat_one.xml'), repeatOneVectorXml, 'utf-8');
writeFileSync(resolve(drawableDir, 'ic_media_play.xml'), mediaPlayVectorXml, 'utf-8');
writeFileSync(resolve(drawableDir, 'ic_media_pause.xml'), mediaPauseVectorXml, 'utf-8');
writeFileSync(resolve(drawableDir, 'ic_media_next.xml'), mediaNextVectorXml, 'utf-8');
writeFileSync(resolve(drawableDir, 'ic_media_prev.xml'), mediaPrevVectorXml, 'utf-8');

// 3. Write res/values/strings.xml & pure-black splash theme res/values/styles.xml
writeFileSync(
  resolve(valuesDir, 'strings.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">pMusic</string>
    <string name="widget_name">pMusic · Reproductor</string>
    <string name="widget_desc">Portada y controles estilo pMusic en tu pantalla de inicio</string>
    <string name="widget_compact_name">pMusic · Mini</string>
    <string name="widget_compact_desc">Barra compacta redondeada con controles rápidos</string>
    <string name="widget_recent_name">pMusic · Recientes</string>
    <string name="widget_recent_desc">Reproducción actual y acceso directo a tu música reciente</string>
    <string name="widget_cover_name">pMusic · Portada</string>
    <string name="widget_cover_desc">Portada cuadrada inmersiva 2×2 con botón de Play</string>
</resources>
`,
  'utf-8'
);

writeFileSync(
  resolve(valuesDir, 'styles.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="PMusicTheme" parent="android:Theme.DeviceDefault.NoActionBar">
        <item name="android:windowBackground">#000000</item>
        <item name="android:colorBackground">#000000</item>
    </style>
</resources>
`,
  'utf-8'
);

// 4. Write AndroidManifest.xml & Android Auto descriptor (compiled into binary AXML by aapt2)
writeFileSync(
  resolve(xmlDir, 'automotive_app_desc.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<automotiveApp>
    <uses name="media" />
</automotiveApp>
`,
  'utf-8'
);

// Home screen widget drawables, metadata & layout (True-Rounded Borderless pMusic Style + 4 Spotify-Class Widgets)
writeFileSync(
  resolve(drawableDir, 'widget_bg_default.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <gradient
        android:angle="135"
        android:startColor="#FF16161F"
        android:endColor="#FF09090D" />
    <corners android:radius="26dp" />
</shape>
`,
  'utf-8'
);

writeFileSync(
  resolve(drawableDir, 'widget_btn_play_white.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="oval">
    <solid android:color="#FFFFFFFF" />
</shape>
`,
  'utf-8'
);

writeFileSync(
  resolve(drawableDir, 'widget_scrim_bottom.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <gradient
        android:angle="270"
        android:startColor="#00000000"
        android:centerColor="#45070709"
        android:endColor="#DF070709" />
    <corners android:radius="26dp" />
</shape>
`,
  'utf-8'
);

writeFileSync(
  resolve(drawableDir, 'widget_cover_bg.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="#FF181822" />
    <corners android:radius="14dp" />
</shape>
`,
  'utf-8'
);

writeFileSync(
  resolve(drawableDir, 'ic_widget_play_dark.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:fillColor="#FF09090E"
        android:pathData="M8.0,4.8 C6.7,4.02 5.2,4.96 5.2,6.45 V17.55 C5.2,19.04 6.7,19.98 8.0,19.2 L18.6,13.1 C19.9,12.35 19.9,10.45 18.6,9.7 L8.0,4.8 Z" />
</vector>
`,
  'utf-8'
);

writeFileSync(
  resolve(drawableDir, 'ic_widget_pause_dark.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:fillColor="#FF09090E"
        android:pathData="M7.6,4.5 C9.0,4.5 10.1,5.6 10.1,7.0 V17.0 C10.1,18.4 9.0,19.5 7.6,19.5 C6.2,19.5 5.1,18.4 5.1,17.0 V7.0 C5.1,5.6 6.2,4.5 7.6,4.5 Z M16.4,4.5 C17.8,4.5 18.9,5.6 18.9,7.0 V17.0 C18.9,18.4 17.8,19.5 16.4,19.5 C15.0,19.5 13.9,18.4 13.9,17.0 V7.0 C13.9,5.6 15.0,4.5 16.4,4.5 Z" />
</vector>
`,
  'utf-8'
);

writeFileSync(
  resolve(drawableDir, 'ic_widget_prev_clean.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="22dp"
    android:height="22dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:fillColor="#F0FFFFFF"
        android:pathData="M5.2,5.0 C6.0,5.0 6.6,5.6 6.6,6.4 V17.6 C6.6,18.4 6.0,19.0 5.2,19.0 C4.4,19.0 3.8,18.4 3.8,17.6 V6.4 C3.8,5.6 4.4,5.0 5.2,5.0 Z M18.4,5.2 C19.4,4.58 20.6,5.32 20.6,6.5 V17.5 C20.6,18.68 19.4,19.42 18.4,18.8 L9.4,13.3 C8.45,12.72 8.45,11.28 9.4,10.7 L18.4,5.2 Z" />
</vector>
`,
  'utf-8'
);

writeFileSync(
  resolve(drawableDir, 'ic_widget_next_clean.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="22dp"
    android:height="22dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:fillColor="#F0FFFFFF"
        android:pathData="M5.6,5.2 C4.6,4.58 3.4,5.32 3.4,6.5 V17.5 C3.4,18.68 4.6,19.42 5.6,18.8 L14.6,13.3 C15.55,12.72 15.55,11.28 14.6,10.7 L5.6,5.2 Z M18.8,5.0 C19.6,5.0 20.2,5.6 20.2,6.4 V17.6 C20.2,18.4 19.6,19.0 18.8,19.0 C18.0,19.0 17.4,18.4 17.4,17.6 V6.4 C17.4,5.6 18.0,5.0 18.8,5.0 Z" />
</vector>
`,
  'utf-8'
);

writeFileSync(
  resolve(drawableDir, 'ic_widget_pmusic_mark.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="20dp"
    android:height="20dp"
    android:viewportWidth="256"
    android:viewportHeight="256">
    <group
        android:translateX="52.56"
        android:translateY="34.00"
        android:scaleX="0.94"
        android:scaleY="0.94">
        <path
            android:fillColor="#C8FFFFFF"
            android:fillType="evenOdd"
            android:pathData="${officialPathData}" />
    </group>
</vector>
`,
  'utf-8'
);

writeFileSync(
  resolve(xmlDir, 'pmusic_widget_info.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<appwidget-provider xmlns:android="http://schemas.android.com/apk/res/android"
    android:minWidth="250dp"
    android:minHeight="110dp"
    android:minResizeWidth="180dp"
    android:minResizeHeight="96dp"
    android:resizeMode="horizontal|vertical"
    android:updatePeriodMillis="0"
    android:initialLayout="@layout/widget_pmusic"
    android:previewImage="@drawable/ic_launcher"
    android:widgetCategory="home_screen" />
`,
  'utf-8'
);

writeFileSync(
  resolve(xmlV31Dir, 'pmusic_widget_info.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<appwidget-provider xmlns:android="http://schemas.android.com/apk/res/android"
    android:minWidth="250dp"
    android:minHeight="110dp"
    android:minResizeWidth="180dp"
    android:minResizeHeight="96dp"
    android:targetCellWidth="4"
    android:targetCellHeight="2"
    android:resizeMode="horizontal|vertical"
    android:updatePeriodMillis="0"
    android:initialLayout="@layout/widget_pmusic"
    android:previewLayout="@layout/widget_pmusic"
    android:previewImage="@drawable/ic_launcher"
    android:description="@string/widget_desc"
    android:widgetCategory="home_screen" />
`,
  'utf-8'
);

writeFileSync(
  resolve(xmlDir, 'pmusic_widget_compact_info.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<appwidget-provider xmlns:android="http://schemas.android.com/apk/res/android"
    android:minWidth="250dp"
    android:minHeight="48dp"
    android:minResizeWidth="180dp"
    android:minResizeHeight="48dp"
    android:resizeMode="horizontal"
    android:updatePeriodMillis="0"
    android:initialLayout="@layout/widget_pmusic_compact"
    android:previewImage="@drawable/ic_launcher"
    android:widgetCategory="home_screen" />
`,
  'utf-8'
);

writeFileSync(
  resolve(xmlV31Dir, 'pmusic_widget_compact_info.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<appwidget-provider xmlns:android="http://schemas.android.com/apk/res/android"
    android:minWidth="250dp"
    android:minHeight="48dp"
    android:minResizeWidth="180dp"
    android:minResizeHeight="48dp"
    android:targetCellWidth="4"
    android:targetCellHeight="1"
    android:resizeMode="horizontal"
    android:updatePeriodMillis="0"
    android:initialLayout="@layout/widget_pmusic_compact"
    android:previewLayout="@layout/widget_pmusic_compact"
    android:previewImage="@drawable/ic_launcher"
    android:description="@string/widget_compact_desc"
    android:widgetCategory="home_screen" />
`,
  'utf-8'
);

writeFileSync(
  resolve(xmlDir, 'pmusic_widget_recent_info.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<appwidget-provider xmlns:android="http://schemas.android.com/apk/res/android"
    android:minWidth="250dp"
    android:minHeight="110dp"
    android:minResizeWidth="200dp"
    android:minResizeHeight="104dp"
    android:resizeMode="horizontal|vertical"
    android:updatePeriodMillis="0"
    android:initialLayout="@layout/widget_pmusic_recent"
    android:previewImage="@drawable/ic_launcher"
    android:widgetCategory="home_screen" />
`,
  'utf-8'
);

writeFileSync(
  resolve(xmlV31Dir, 'pmusic_widget_recent_info.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<appwidget-provider xmlns:android="http://schemas.android.com/apk/res/android"
    android:minWidth="250dp"
    android:minHeight="110dp"
    android:minResizeWidth="200dp"
    android:minResizeHeight="104dp"
    android:targetCellWidth="4"
    android:targetCellHeight="2"
    android:resizeMode="horizontal|vertical"
    android:updatePeriodMillis="0"
    android:initialLayout="@layout/widget_pmusic_recent"
    android:previewLayout="@layout/widget_pmusic_recent"
    android:previewImage="@drawable/ic_launcher"
    android:description="@string/widget_recent_desc"
    android:widgetCategory="home_screen" />
`,
  'utf-8'
);

writeFileSync(
  resolve(xmlDir, 'pmusic_widget_cover_info.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<appwidget-provider xmlns:android="http://schemas.android.com/apk/res/android"
    android:minWidth="120dp"
    android:minHeight="120dp"
    android:minResizeWidth="110dp"
    android:minResizeHeight="110dp"
    android:resizeMode="horizontal|vertical"
    android:updatePeriodMillis="0"
    android:initialLayout="@layout/widget_pmusic_cover"
    android:previewImage="@drawable/ic_launcher"
    android:widgetCategory="home_screen" />
`,
  'utf-8'
);

writeFileSync(
  resolve(xmlV31Dir, 'pmusic_widget_cover_info.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<appwidget-provider xmlns:android="http://schemas.android.com/apk/res/android"
    android:minWidth="120dp"
    android:minHeight="120dp"
    android:minResizeWidth="110dp"
    android:minResizeHeight="110dp"
    android:targetCellWidth="2"
    android:targetCellHeight="2"
    android:resizeMode="horizontal|vertical"
    android:updatePeriodMillis="0"
    android:initialLayout="@layout/widget_pmusic_cover"
    android:previewLayout="@layout/widget_pmusic_cover"
    android:previewImage="@drawable/ic_launcher"
    android:description="@string/widget_cover_desc"
    android:widgetCategory="home_screen" />
`,
  'utf-8'
);

writeFileSync(
  resolve(layoutDir, 'widget_pmusic_compact.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<RelativeLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:id="@+id/widget_root"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:clipToOutline="true"
    android:background="@drawable/widget_bg_default">

    <ImageView
        android:id="@+id/widget_bg_image"
        android:layout_width="match_parent"
        android:layout_height="match_parent"
        android:scaleType="centerCrop"
        android:contentDescription="@null" />

    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="match_parent"
        android:orientation="horizontal"
        android:gravity="center_vertical"
        android:paddingStart="12dp"
        android:paddingEnd="12dp"
        android:paddingTop="8dp"
        android:paddingBottom="8dp">

        <ImageView
            android:id="@+id/widget_cover"
            android:layout_width="44dp"
            android:layout_height="44dp"
            android:scaleType="centerCrop"
            android:src="@drawable/ic_launcher"
            android:contentDescription="Portada actual" />

        <LinearLayout
            android:layout_width="0dp"
            android:layout_height="wrap_content"
            android:layout_weight="1"
            android:orientation="vertical"
            android:paddingStart="10dp"
            android:paddingEnd="8dp">

            <TextView
                android:id="@+id/widget_title"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:text="pMusic"
                android:textSize="14sp"
                android:textColor="#FFFFFFFF"
                android:textStyle="bold"
                android:maxLines="1"
                android:ellipsize="end" />

            <TextView
                android:id="@+id/widget_artist"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:text="Toca para reproducir"
                android:textSize="11.5sp"
                android:textColor="#B8FFFFFF"
                android:maxLines="1"
                android:ellipsize="end" />
        </LinearLayout>

        <LinearLayout
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:orientation="horizontal"
            android:gravity="center_vertical">

            <ImageButton
                android:id="@+id/widget_prev"
                android:layout_width="34dp"
                android:layout_height="34dp"
                android:background="@android:color/transparent"
                android:src="@drawable/ic_widget_prev_clean"
                android:scaleType="centerInside"
                android:contentDescription="Anterior" />

            <ImageButton
                android:id="@+id/widget_toggle"
                android:layout_width="38dp"
                android:layout_height="38dp"
                android:layout_marginStart="4dp"
                android:layout_marginEnd="4dp"
                android:background="@drawable/widget_btn_play_white"
                android:src="@drawable/ic_widget_play_dark"
                android:scaleType="centerInside"
                android:contentDescription="Reproducir o pausar" />

            <ImageButton
                android:id="@+id/widget_next"
                android:layout_width="34dp"
                android:layout_height="34dp"
                android:background="@android:color/transparent"
                android:src="@drawable/ic_widget_next_clean"
                android:scaleType="centerInside"
                android:contentDescription="Siguiente" />
        </LinearLayout>
    </LinearLayout>
</RelativeLayout>
`,
  'utf-8'
);

writeFileSync(
  resolve(layoutDir, 'widget_pmusic.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<RelativeLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:id="@+id/widget_root"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:clipToOutline="true"
    android:background="@drawable/widget_bg_default">

    <ImageView
        android:id="@+id/widget_bg_image"
        android:layout_width="match_parent"
        android:layout_height="match_parent"
        android:scaleType="centerCrop"
        android:contentDescription="@null" />

    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="match_parent"
        android:orientation="vertical"
        android:gravity="center_vertical"
        android:paddingStart="16dp"
        android:paddingEnd="16dp"
        android:paddingTop="14dp"
        android:paddingBottom="12dp">

        <LinearLayout
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:orientation="horizontal"
            android:gravity="center_vertical">

            <ImageView
                android:id="@+id/widget_cover"
                android:layout_width="60dp"
                android:layout_height="60dp"
                android:scaleType="centerCrop"
                android:src="@drawable/ic_launcher"
                android:contentDescription="Portada actual" />

            <LinearLayout
                android:layout_width="0dp"
                android:layout_height="wrap_content"
                android:layout_weight="1"
                android:orientation="vertical"
                android:paddingStart="12dp"
                android:paddingEnd="8dp">

                <TextView
                    android:id="@+id/widget_title"
                    android:layout_width="match_parent"
                    android:layout_height="wrap_content"
                    android:text="pMusic"
                    android:textSize="16sp"
                    android:textColor="#FFFFFFFF"
                    android:textStyle="bold"
                    android:maxLines="1"
                    android:ellipsize="end" />

                <TextView
                    android:id="@+id/widget_artist"
                    android:layout_width="match_parent"
                    android:layout_height="wrap_content"
                    android:layout_marginTop="2dp"
                    android:text="Toca para reproducir"
                    android:textSize="12.5sp"
                    android:textColor="#BAFFFFFF"
                    android:maxLines="1"
                    android:ellipsize="end" />
            </LinearLayout>

            <ImageView
                android:layout_width="18dp"
                android:layout_height="18dp"
                android:layout_gravity="top"
                android:src="@drawable/ic_widget_pmusic_mark"
                android:contentDescription="@null" />
        </LinearLayout>

        <LinearLayout
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:layout_marginTop="10dp"
            android:orientation="horizontal"
            android:gravity="center">

            <ImageButton
                android:id="@+id/widget_prev"
                android:layout_width="40dp"
                android:layout_height="40dp"
                android:background="@android:color/transparent"
                android:src="@drawable/ic_widget_prev_clean"
                android:scaleType="centerInside"
                android:contentDescription="Anterior" />

            <ImageButton
                android:id="@+id/widget_toggle"
                android:layout_width="46dp"
                android:layout_height="46dp"
                android:layout_marginStart="22dp"
                android:layout_marginEnd="22dp"
                android:background="@drawable/widget_btn_play_white"
                android:src="@drawable/ic_widget_play_dark"
                android:scaleType="centerInside"
                android:contentDescription="Reproducir o pausar" />

            <ImageButton
                android:id="@+id/widget_next"
                android:layout_width="40dp"
                android:layout_height="40dp"
                android:background="@android:color/transparent"
                android:src="@drawable/ic_widget_next_clean"
                android:scaleType="centerInside"
                android:contentDescription="Siguiente" />
        </LinearLayout>
    </LinearLayout>
</RelativeLayout>
`,
  'utf-8'
);

writeFileSync(
  resolve(layoutDir, 'widget_pmusic_recent.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<RelativeLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:id="@+id/widget_root"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:clipToOutline="true"
    android:background="@drawable/widget_bg_default">

    <ImageView
        android:id="@+id/widget_bg_image"
        android:layout_width="match_parent"
        android:layout_height="match_parent"
        android:scaleType="centerCrop"
        android:contentDescription="@null" />

    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="match_parent"
        android:orientation="vertical"
        android:paddingStart="14dp"
        android:paddingEnd="14dp"
        android:paddingTop="12dp"
        android:paddingBottom="10dp">

        <LinearLayout
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:orientation="horizontal"
            android:gravity="center_vertical">

            <ImageView
                android:id="@+id/widget_cover"
                android:layout_width="42dp"
                android:layout_height="42dp"
                android:scaleType="centerCrop"
                android:src="@drawable/ic_launcher"
                android:contentDescription="Portada actual" />

            <LinearLayout
                android:layout_width="0dp"
                android:layout_height="wrap_content"
                android:layout_weight="1"
                android:orientation="vertical"
                android:paddingStart="10dp"
                android:paddingEnd="8dp">

                <TextView
                    android:id="@+id/widget_title"
                    android:layout_width="match_parent"
                    android:layout_height="wrap_content"
                    android:text="pMusic"
                    android:textSize="14sp"
                    android:textColor="#FFFFFFFF"
                    android:textStyle="bold"
                    android:maxLines="1"
                    android:ellipsize="end" />

                <TextView
                    android:id="@+id/widget_artist"
                    android:layout_width="match_parent"
                    android:layout_height="wrap_content"
                    android:text="Recientes"
                    android:textSize="11sp"
                    android:textColor="#B8FFFFFF"
                    android:maxLines="1"
                    android:ellipsize="end" />
            </LinearLayout>

            <ImageButton
                android:id="@+id/widget_toggle"
                android:layout_width="36dp"
                android:layout_height="36dp"
                android:background="@drawable/widget_btn_play_white"
                android:src="@drawable/ic_widget_play_dark"
                android:scaleType="centerInside"
                android:contentDescription="Reproducir o pausar" />

            <ImageView
                android:layout_width="16dp"
                android:layout_height="16dp"
                android:layout_marginStart="10dp"
                android:src="@drawable/ic_widget_pmusic_mark"
                android:contentDescription="@null" />
        </LinearLayout>

        <LinearLayout
            android:layout_width="match_parent"
            android:layout_height="0dp"
            android:layout_weight="1"
            android:layout_marginTop="10dp"
            android:orientation="horizontal"
            android:gravity="center_vertical">

            <LinearLayout
                android:id="@+id/widget_recent_box_0"
                android:layout_width="0dp"
                android:layout_height="match_parent"
                android:layout_weight="1"
                android:orientation="vertical"
                android:gravity="center_horizontal"
                android:paddingEnd="4dp">

                <ImageView
                    android:id="@+id/widget_recent_img_0"
                    android:layout_width="50dp"
                    android:layout_height="50dp"
                    android:scaleType="centerCrop"
                    android:src="@drawable/ic_launcher"
                    android:contentDescription="Reciente 1" />

                <TextView
                    android:id="@+id/widget_recent_txt_0"
                    android:layout_width="match_parent"
                    android:layout_height="wrap_content"
                    android:layout_marginTop="3dp"
                    android:gravity="center"
                    android:text="Inicio"
                    android:textSize="10sp"
                    android:textColor="#D6FFFFFF"
                    android:maxLines="1"
                    android:ellipsize="end" />
            </LinearLayout>

            <LinearLayout
                android:id="@+id/widget_recent_box_1"
                android:layout_width="0dp"
                android:layout_height="match_parent"
                android:layout_weight="1"
                android:orientation="vertical"
                android:gravity="center_horizontal"
                android:paddingStart="2dp"
                android:paddingEnd="2dp">

                <ImageView
                    android:id="@+id/widget_recent_img_1"
                    android:layout_width="50dp"
                    android:layout_height="50dp"
                    android:scaleType="centerCrop"
                    android:src="@drawable/ic_launcher"
                    android:contentDescription="Reciente 2" />

                <TextView
                    android:id="@+id/widget_recent_txt_1"
                    android:layout_width="match_parent"
                    android:layout_height="wrap_content"
                    android:layout_marginTop="3dp"
                    android:gravity="center"
                    android:text="Mix"
                    android:textSize="10sp"
                    android:textColor="#D6FFFFFF"
                    android:maxLines="1"
                    android:ellipsize="end" />
            </LinearLayout>

            <LinearLayout
                android:id="@+id/widget_recent_box_2"
                android:layout_width="0dp"
                android:layout_height="match_parent"
                android:layout_weight="1"
                android:orientation="vertical"
                android:gravity="center_horizontal"
                android:paddingStart="2dp"
                android:paddingEnd="2dp">

                <ImageView
                    android:id="@+id/widget_recent_img_2"
                    android:layout_width="50dp"
                    android:layout_height="50dp"
                    android:scaleType="centerCrop"
                    android:src="@drawable/ic_launcher"
                    android:contentDescription="Reciente 3" />

                <TextView
                    android:id="@+id/widget_recent_txt_2"
                    android:layout_width="match_parent"
                    android:layout_height="wrap_content"
                    android:layout_marginTop="3dp"
                    android:gravity="center"
                    android:text="Música"
                    android:textSize="10sp"
                    android:textColor="#D6FFFFFF"
                    android:maxLines="1"
                    android:ellipsize="end" />
            </LinearLayout>

            <LinearLayout
                android:id="@+id/widget_recent_box_3"
                android:layout_width="0dp"
                android:layout_height="match_parent"
                android:layout_weight="1"
                android:orientation="vertical"
                android:gravity="center_horizontal"
                android:paddingStart="4dp">

                <ImageView
                    android:id="@+id/widget_recent_img_3"
                    android:layout_width="50dp"
                    android:layout_height="50dp"
                    android:scaleType="centerCrop"
                    android:src="@drawable/ic_launcher"
                    android:contentDescription="Reciente 4" />

                <TextView
                    android:id="@+id/widget_recent_txt_3"
                    android:layout_width="match_parent"
                    android:layout_height="wrap_content"
                    android:layout_marginTop="3dp"
                    android:gravity="center"
                    android:text="pMusic"
                    android:textSize="10sp"
                    android:textColor="#D6FFFFFF"
                    android:maxLines="1"
                    android:ellipsize="end" />
            </LinearLayout>
        </LinearLayout>
    </LinearLayout>
</RelativeLayout>
`,
  'utf-8'
);

writeFileSync(
  resolve(layoutDir, 'widget_pmusic_cover.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<RelativeLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:id="@+id/widget_root"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:clipToOutline="true"
    android:background="@drawable/widget_bg_default">

    <ImageView
        android:id="@+id/widget_cover"
        android:layout_width="match_parent"
        android:layout_height="match_parent"
        android:scaleType="centerCrop"
        android:src="@drawable/ic_launcher"
        android:contentDescription="Portada actual" />

    <ImageView
        android:layout_width="match_parent"
        android:layout_height="match_parent"
        android:src="@drawable/widget_scrim_bottom"
        android:scaleType="fitXY"
        android:contentDescription="@null" />

    <ImageView
        android:layout_width="18dp"
        android:layout_height="18dp"
        android:layout_alignParentTop="true"
        android:layout_alignParentStart="true"
        android:layout_marginStart="12dp"
        android:layout_marginTop="12dp"
        android:src="@drawable/ic_widget_pmusic_mark"
        android:contentDescription="@null" />

    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:layout_alignParentBottom="true"
        android:orientation="horizontal"
        android:gravity="center_vertical"
        android:paddingStart="12dp"
        android:paddingEnd="12dp"
        android:paddingBottom="12dp">

        <LinearLayout
            android:layout_width="0dp"
            android:layout_height="wrap_content"
            android:layout_weight="1"
            android:orientation="vertical"
            android:paddingEnd="8dp">

            <TextView
                android:id="@+id/widget_title"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:text="pMusic"
                android:textSize="13sp"
                android:textColor="#FFFFFFFF"
                android:textStyle="bold"
                android:maxLines="1"
                android:ellipsize="end" />

            <TextView
                android:id="@+id/widget_artist"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:text="Toca para reproducir"
                android:textSize="10.5sp"
                android:textColor="#CCFFFFFF"
                android:maxLines="1"
                android:ellipsize="end" />
        </LinearLayout>

        <ImageButton
            android:id="@+id/widget_toggle"
            android:layout_width="38dp"
            android:layout_height="38dp"
            android:background="@drawable/widget_btn_play_white"
            android:src="@drawable/ic_widget_play_dark"
            android:scaleType="centerInside"
            android:contentDescription="Reproducir o pausar" />
    </LinearLayout>
</RelativeLayout>
`,
  'utf-8'
);

const manifestPath = resolve(workDir, 'AndroidManifest.xml');
writeFileSync(
  manifestPath,
  `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="es.pmusic.app"
    android:versionCode="70"
    android:versionName="0.24.9">

    <uses-sdk android:minSdkVersion="24" android:targetSdkVersion="34" />

    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />
    <uses-permission android:name="android.permission.WAKE_LOCK" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
    <uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />

    <application
        android:allowBackup="true"
        android:icon="@drawable/ic_launcher"
        android:label="@string/app_name"
        android:usesCleartextTraffic="true"
        android:hardwareAccelerated="true"
        android:theme="@style/PMusicTheme">

        <provider
            android:name="es.pmusic.app.PMusicApkProvider"
            android:authorities="es.pmusic.app.fileprovider"
            android:exported="false"
            android:grantUriPermissions="true" />

        <meta-data
            android:name="com.google.android.gms.car.application"
            android:resource="@xml/automotive_app_desc" />
        <meta-data
            android:name="com.google.android.gms.car.notification.SmallIcon"
            android:resource="@drawable/ic_stat_pmusic" />

        <activity
            android:name="es.pmusic.app.MainActivity"
            android:exported="true"
            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|uiMode"
            android:launchMode="singleTask">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="pmusic" android:host="auth" />
            </intent-filter>
        </activity>

        <service
            android:name="es.pmusic.app.PMusicPlaybackService"
            android:enabled="true"
            android:exported="false"
            android:foregroundServiceType="mediaPlayback" />

        <service
            android:name="es.pmusic.app.PMusicMediaBrowserService"
            android:enabled="true"
            android:exported="true"
            android:foregroundServiceType="mediaPlayback">
            <intent-filter>
                <action android:name="android.media.browse.MediaBrowserService" />
            </intent-filter>
        </service>

        <receiver
            android:name="es.pmusic.app.PMusicWidgetProvider"
            android:enabled="true"
            android:exported="true"
            android:label="@string/widget_name">
            <intent-filter>
                <action android:name="android.appwidget.action.APPWIDGET_UPDATE" />
            </intent-filter>
            <meta-data
                android:name="android.appwidget.provider"
                android:resource="@xml/pmusic_widget_info" />
        </receiver>

        <receiver
            android:name="es.pmusic.app.PMusicCompactWidgetProvider"
            android:enabled="true"
            android:exported="true"
            android:label="@string/widget_compact_name">
            <intent-filter>
                <action android:name="android.appwidget.action.APPWIDGET_UPDATE" />
            </intent-filter>
            <meta-data
                android:name="android.appwidget.provider"
                android:resource="@xml/pmusic_widget_compact_info" />
        </receiver>

        <receiver
            android:name="es.pmusic.app.PMusicRecentWidgetProvider"
            android:enabled="true"
            android:exported="true"
            android:label="@string/widget_recent_name">
            <intent-filter>
                <action android:name="android.appwidget.action.APPWIDGET_UPDATE" />
            </intent-filter>
            <meta-data
                android:name="android.appwidget.provider"
                android:resource="@xml/pmusic_widget_recent_info" />
        </receiver>

        <receiver
            android:name="es.pmusic.app.PMusicCoverWidgetProvider"
            android:enabled="true"
            android:exported="true"
            android:label="@string/widget_cover_name">
            <intent-filter>
                <action android:name="android.appwidget.action.APPWIDGET_UPDATE" />
            </intent-filter>
            <meta-data
                android:name="android.appwidget.provider"
                android:resource="@xml/pmusic_widget_cover_info" />
        </receiver>

        <service
            android:name="es.pmusic.app.PMusicReleaseCheckJobService"
            android:permission="android.permission.BIND_JOB_SERVICE"
            android:exported="false" />
    </application>
</manifest>
`,
  'utf-8'
);

// 5. Write Java sources (PMusicPlaybackService with MediaSession+Notification.MediaStyle, PMusicMediaBrowserService for Android Auto, MainActivity)
writeFileSync(
  resolve(javaSrcDir, 'PMusicPlaybackService.java'),
  `package es.pmusic.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Shader;
import android.graphics.Typeface;
import android.media.AudioManager;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.os.PowerManager;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class PMusicPlaybackService extends Service {
    private static final String CHANNEL_ID = "pmusic_playback_channel";
    private static final int NOTIFICATION_ID = 1001;
    public static final String ACTION_SHUFFLE = "es.pmusic.app.ACTION_SHUFFLE";
    public static final String ACTION_PREV = "es.pmusic.app.ACTION_PREV";
    public static final String ACTION_TOGGLE = "es.pmusic.app.ACTION_TOGGLE";
    public static final String ACTION_NEXT = "es.pmusic.app.ACTION_NEXT";
    public static final String ACTION_REPEAT = "es.pmusic.app.ACTION_REPEAT";
    public static final String ACTION_STOP = "es.pmusic.app.ACTION_STOP";
    public static final String CUSTOM_ACTION_SHUFFLE = "es.pmusic.app.CUSTOM_SHUFFLE";
    public static final String CUSTOM_ACTION_REPEAT = "es.pmusic.app.CUSTOM_REPEAT";

    private static volatile MediaSession sMediaSession;
    private static volatile PMusicPlaybackService sServiceInstance;
    private static final ExecutorService ART_EXECUTOR = Executors.newSingleThreadExecutor();
    private static final Map<String, Bitmap> ART_CACHE = new LinkedHashMap<String, Bitmap>(16, 0.75f, true) {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, Bitmap> eldest) {
            return size() > 12;
        }
    };

    private static volatile String sTrackId = "";
    private static volatile String sTitle = "pMusic";
    private static volatile String sArtist = "Listo para reproducir";
    private static volatile String sAlbum = "pMusic";
    private static volatile String sArtworkUrl = "";
    private static volatile String sArtworkFailedUrl = "";
    private static volatile boolean sIsPlaying = false;
    private static volatile boolean sShuffleEnabled = false;
    private static volatile String sRepeatMode = "off";
    private static volatile long sPositionMs = 0L;
    private static volatile long sDurationMs = 200000L;
    private static volatile Bitmap sMissingCoverBmp = null;

    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;
    private BroadcastReceiver noisyReceiver;
    private boolean noisyRegistered = false;

    public static boolean isCurrentlyPlaying() {
        return sIsPlaying;
    }

    public static boolean isServiceActive() {
        return sServiceInstance != null;
    }

    public static String getWidgetTitle() {
        return sTitle;
    }

    public static String getWidgetArtist() {
        return sArtist;
    }

    public static Bitmap getWidgetCoverBitmap() {
        return (!sArtworkUrl.isEmpty() ? getCachedBitmap(sArtworkUrl) : null);
    }

    public static synchronized MediaSession.Token getOrCreateSessionToken(Context ctx) {
        ensureMediaSessionStatic(ctx.getApplicationContext());
        return sMediaSession.getSessionToken();
    }

    private static synchronized void ensureMediaSessionStatic(final Context appCtx) {
        if (sMediaSession != null) return;
        MediaSession session = new MediaSession(appCtx, "pMusicMediaSession");
        session.setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS | MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS);
        session.setCallback(new MediaSession.Callback() {
            @Override
            public void onPlay() {
                MainActivity.dispatchMediaAction(appCtx, "play", -1);
            }

            @Override
            public void onPause() {
                MainActivity.dispatchMediaAction(appCtx, "pause", -1);
            }

            @Override
            public void onSkipToNext() {
                MainActivity.dispatchMediaAction(appCtx, "nexttrack", -1);
            }

            @Override
            public void onSkipToPrevious() {
                MainActivity.dispatchMediaAction(appCtx, "previoustrack", -1);
            }

            @Override
            public void onStop() {
                MainActivity.dispatchMediaAction(appCtx, "pause", -1);
            }

            @Override
            public void onSeekTo(long posMs) {
                MainActivity.dispatchMediaAction(appCtx, "seekto", posMs / 1000.0);
            }

            @Override
            public void onPlayFromSearch(String query, Bundle extras) {
                MainActivity.dispatchCarPlayFromSearch(appCtx, query != null ? query : "");
            }

            @Override
            public void onPlayFromMediaId(String mediaId, Bundle extras) {
                MainActivity.dispatchCarPlayFromMediaId(appCtx, mediaId != null ? mediaId : "");
            }

            @Override
            public void onCustomAction(String action, Bundle extras) {
                if (CUSTOM_ACTION_SHUFFLE.equals(action)) {
                    sShuffleEnabled = !sShuffleEnabled;
                    MainActivity.dispatchMediaAction(appCtx, "shuffle", -1);
                    if (sServiceInstance != null) {
                        sServiceInstance.syncMediaSessionAndNotification(true);
                    }
                } else if (CUSTOM_ACTION_REPEAT.equals(action)) {
                    sRepeatMode = "off".equals(sRepeatMode) ? "all" : "all".equals(sRepeatMode) ? "one" : "off";
                    MainActivity.dispatchMediaAction(appCtx, "repeat", -1);
                    if (sServiceInstance != null) {
                        sServiceInstance.syncMediaSessionAndNotification(true);
                    }
                }
            }
        });
        session.setActive(true);
        sMediaSession = session;
    }

    public static String sanitizeCoverFileId(String raw) {
        if (raw == null || raw.isEmpty()) return "unknown";
        return raw.replaceAll("[^a-zA-Z0-9._-]", "_");
    }

    public static void saveOfflineCoverBytes(Context ctx, String trackId, byte[] raw) {
        if (ctx == null || trackId == null || trackId.isEmpty() || raw == null || raw.length < 256) return;
        try {
            File dir = new File(ctx.getFilesDir(), "offline_covers");
            if (!dir.exists()) dir.mkdirs();
            File dst = new File(dir, sanitizeCoverFileId(trackId) + ".jpg");
            FileOutputStream fos = new FileOutputStream(dst);
            fos.write(raw);
            fos.close();
        } catch (Throwable ignored) {
        }
    }

    private static Bitmap loadOfflineCoverBitmap(Context ctx, String trackId) {
        if (ctx == null || trackId == null || trackId.isEmpty()) return null;
        try {
            File f = new File(new File(ctx.getFilesDir(), "offline_covers"), sanitizeCoverFileId(trackId) + ".jpg");
            if (!f.exists() || f.length() < 128) return null;
            Bitmap bmp = BitmapFactory.decodeFile(f.getAbsolutePath());
            if (bmp != null && (bmp.getWidth() > 512 || bmp.getHeight() > 512)) {
                Bitmap scaled = Bitmap.createScaledBitmap(bmp, 512, 512, true);
                if (scaled != bmp) bmp.recycle();
                return scaled;
            }
            return bmp;
        } catch (Throwable ignored) {
            return null;
        }
    }

    private static boolean isNetworkConnected(Context ctx) {
        try {
            ConnectivityManager cm = (ConnectivityManager) ctx.getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null) return true;
            NetworkInfo ni = cm.getActiveNetworkInfo();
            return ni != null && ni.isConnected();
        } catch (Throwable ignored) {
            return true;
        }
    }

    private static synchronized Bitmap buildMissingCoverBitmap() {
        if (sMissingCoverBmp != null && !sMissingCoverBmp.isRecycled()) {
            return sMissingCoverBmp;
        }
        Bitmap bmp = Bitmap.createBitmap(512, 512, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bmp);
        Paint bgPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        bgPaint.setShader(new LinearGradient(0f, 0f, 512f, 512f, 0xFF1A1A22, 0xFF08080C, Shader.TileMode.CLAMP));
        canvas.drawRect(0f, 0f, 512f, 512f, bgPaint);

        Paint cardPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        cardPaint.setColor(0x14FFFFFF);
        canvas.drawRoundRect(new RectF(32f, 32f, 480f, 480f), 44f, 44f, cardPaint);

        Paint borderPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        borderPaint.setStyle(Paint.Style.STROKE);
        borderPaint.setStrokeWidth(3f);
        borderPaint.setColor(0x28FFFFFF);
        canvas.drawRoundRect(new RectF(32f, 32f, 480f, 480f), 44f, 44f, borderPaint);

        // Minimalist pMusic 4-bar acoustic wave icon above text
        Paint barPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        barPaint.setColor(0xEEFFFFFF);
        canvas.drawRoundRect(new RectF(204f, 134f, 220f, 186f), 8f, 8f, barPaint);
        barPaint.setColor(0xFFE2CCFF);
        canvas.drawRoundRect(new RectF(230f, 114f, 246f, 206f), 8f, 8f, barPaint);
        barPaint.setColor(0xFFFFFFFF);
        canvas.drawRoundRect(new RectF(256f, 126f, 272f, 194f), 8f, 8f, barPaint);
        barPaint.setColor(0xCCFFFFFF);
        canvas.drawRoundRect(new RectF(282f, 144f, 298f, 176f), 8f, 8f, barPaint);

        Paint titlePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        titlePaint.setColor(0xFFFFFFFF);
        titlePaint.setTextSize(34f);
        titlePaint.setTextAlign(Paint.Align.CENTER);
        titlePaint.setTypeface(Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD));
        canvas.drawText("Lo sentimos", 256f, 276f, titlePaint);

        Paint subPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        subPaint.setColor(0xB8FFFFFF);
        subPaint.setTextSize(25f);
        subPaint.setTextAlign(Paint.Align.CENTER);
        canvas.drawText("No se pudo cargar", 256f, 322f, subPaint);
        canvas.drawText("la portada", 256f, 356f, subPaint);

        Paint brandPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        brandPaint.setColor(0x66FFFFFF);
        brandPaint.setTextSize(20f);
        brandPaint.setTextAlign(Paint.Align.CENTER);
        brandPaint.setTypeface(Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD));
        canvas.drawText("pMusic", 256f, 430f, brandPaint);

        sMissingCoverBmp = bmp;
        return bmp;
    }

    public static void updateFromJson(final Context ctx, final String jsonStr) {
        try {
            JSONObject obj = new JSONObject(jsonStr);
            String nextTrackId = obj.optString("trackId", "");
            String nextTitle = obj.optString("title", "pMusic");
            String nextArtist = obj.optString("artist", "");
            String nextAlbum = obj.optString("album", "pMusic");
            String nextArt = obj.optString("artworkUrl", "");
            boolean nextPlaying = obj.optBoolean("isPlaying", false);
            boolean nextShuffle = obj.optBoolean("shuffleEnabled", sShuffleEnabled);
            String nextRepeat = obj.optString("repeatMode", sRepeatMode);
            if (!"off".equals(nextRepeat) && !"all".equals(nextRepeat) && !"one".equals(nextRepeat)) {
                nextRepeat = "off";
            }

            boolean metaChanged = !nextTrackId.equals(sTrackId)
                    || !nextTitle.equals(sTitle)
                    || !nextArtist.equals(sArtist)
                    || !nextAlbum.equals(sAlbum)
                    || !nextArt.equals(sArtworkUrl)
                    || nextPlaying != sIsPlaying
                    || nextShuffle != sShuffleEnabled
                    || !nextRepeat.equals(sRepeatMode);
            boolean artChanged = !nextArt.equals(sArtworkUrl);
            if (artChanged) {
                sArtworkFailedUrl = "";
            }

            sTrackId = nextTrackId;
            sTitle = nextTitle;
            sArtist = nextArtist;
            sAlbum = nextAlbum;
            sArtworkUrl = nextArt;
            sIsPlaying = nextPlaying;
            sShuffleEnabled = nextShuffle;
            sRepeatMode = nextRepeat;
            sPositionMs = Math.max(0L, obj.optLong("positionMs", 0L));
            sDurationMs = Math.max(1000L, obj.optLong("durationMs", 200000L));

            if (sServiceInstance == null) {
                Intent svc = new Intent(ctx, PMusicPlaybackService.class);
                try {
                    if (Build.VERSION.SDK_INT >= 26) {
                        ctx.startForegroundService(svc);
                    } else {
                        ctx.startService(svc);
                    }
                } catch (Throwable ignored) {
                }
            } else {
                sServiceInstance.updateLocks(sIsPlaying);
                sServiceInstance.syncMediaSessionAndNotification(metaChanged);
            }

            if (artChanged && !nextArt.isEmpty()) {
                Bitmap cached = getCachedBitmap(nextArt);
                if (cached == null) {
                    Bitmap offlineBmp = loadOfflineCoverBitmap(ctx, nextTrackId);
                    if (offlineBmp != null) {
                        putCachedBitmap(nextArt, offlineBmp);
                        if (sServiceInstance != null) {
                            sServiceInstance.syncMediaSessionAndNotification(true);
                        }
                    } else {
                        final String targetUrl = nextArt;
                        final String targetTrackId = nextTrackId;
                        final Context appCtx = ctx.getApplicationContext();
                        ART_EXECUTOR.execute(new Runnable() {
                            @Override
                            public void run() {
                                byte[] raw = fetchArtworkBytes(targetUrl);
                                Bitmap bmp = null;
                                if (raw != null && raw.length > 0) {
                                    bmp = BitmapFactory.decodeByteArray(raw, 0, raw.length);
                                    if (bmp != null && (bmp.getWidth() > 512 || bmp.getHeight() > 512)) {
                                        Bitmap scaled = Bitmap.createScaledBitmap(bmp, 512, 512, true);
                                        if (scaled != bmp) bmp.recycle();
                                        bmp = scaled;
                                    }
                                    if (bmp != null && !targetTrackId.isEmpty()) {
                                        saveOfflineCoverBytes(appCtx, targetTrackId, raw);
                                    }
                                }
                                if (bmp != null) {
                                    putCachedBitmap(targetUrl, bmp);
                                } else {
                                    sArtworkFailedUrl = targetUrl;
                                }
                                if (targetUrl.equals(sArtworkUrl) && sServiceInstance != null) {
                                    sServiceInstance.syncMediaSessionAndNotification(true);
                                }
                            }
                        });
                    }
                }
            }
        } catch (Throwable ignored) {
        }
    }

    private static synchronized Bitmap getCachedBitmap(String url) {
        return ART_CACHE.get(url);
    }

    private static synchronized void putCachedBitmap(String url, Bitmap bmp) {
        ART_CACHE.put(url, bmp);
    }

    private static byte[] fetchArtworkBytes(String urlStr) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(urlStr);
            conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(3500);
            conn.setReadTimeout(4500);
            conn.setInstanceFollowRedirects(true);
            conn.setRequestProperty("User-Agent", "pMusic-Android/0.23.0");
            if (conn.getResponseCode() >= 200 && conn.getResponseCode() < 300) {
                InputStream in = conn.getInputStream();
                ByteArrayOutputStream bos = new ByteArrayOutputStream();
                byte[] buf = new byte[8192];
                int r;
                while ((r = in.read(buf)) != -1) {
                    bos.write(buf, 0, r);
                }
                in.close();
                return bos.toByteArray();
            }
        } catch (Throwable ignored) {
        } finally {
            if (conn != null) conn.disconnect();
        }
        return null;
    }

    private PendingIntent makeServiceActionIntent(String action, int reqCode) {
        Intent i = new Intent(this, PMusicPlaybackService.class);
        i.setAction(action);
        int flags = Build.VERSION.SDK_INT >= 23
                ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                : PendingIntent.FLAG_UPDATE_CURRENT;
        return PendingIntent.getService(this, reqCode, i, flags);
    }

    public void syncMediaSessionAndNotification() {
        syncMediaSessionAndNotification(true);
    }

    public void syncMediaSessionAndNotification(boolean refreshNotification) {
        try {
            ensureMediaSessionStatic(getApplicationContext());

            long actions = PlaybackState.ACTION_PLAY
                    | PlaybackState.ACTION_PAUSE
                    | PlaybackState.ACTION_PLAY_PAUSE
                    | PlaybackState.ACTION_SKIP_TO_NEXT
                    | PlaybackState.ACTION_SKIP_TO_PREVIOUS
                    | PlaybackState.ACTION_SEEK_TO
                    | PlaybackState.ACTION_STOP;
            int pbState = sIsPlaying ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED;
            int shuffleIconRes = sShuffleEnabled ? R.drawable.ic_media_shuffle_on : R.drawable.ic_media_shuffle_off;
            String shuffleLabel = sShuffleEnabled ? "Aleatorio activado" : "Aleatorio";
            int repeatIconRes = "one".equals(sRepeatMode)
                    ? R.drawable.ic_media_repeat_one
                    : "all".equals(sRepeatMode)
                            ? R.drawable.ic_media_repeat_all
                            : R.drawable.ic_media_repeat_off;
            String repeatLabel = "one".equals(sRepeatMode)
                    ? "Repetir una"
                    : "all".equals(sRepeatMode)
                            ? "Repetir lista"
                            : "No repetir";

            PlaybackState state = new PlaybackState.Builder()
                    .setActions(actions)
                    .setState(pbState, sPositionMs, sIsPlaying ? 1.0f : 0.0f)
                    .addCustomAction(new PlaybackState.CustomAction.Builder(CUSTOM_ACTION_SHUFFLE, shuffleLabel, shuffleIconRes).build())
                    .addCustomAction(new PlaybackState.CustomAction.Builder(CUSTOM_ACTION_REPEAT, repeatLabel, repeatIconRes).build())
                    .build();
            sMediaSession.setPlaybackState(state);

            if (!refreshNotification) {
                return;
            }

            Bitmap artBmp = !sArtworkUrl.isEmpty() ? getCachedBitmap(sArtworkUrl) : null;
            if (artBmp == null && !sTrackId.isEmpty()) {
                artBmp = loadOfflineCoverBitmap(this, sTrackId);
            }
            if (artBmp == null && (!sArtworkFailedUrl.isEmpty() && sArtworkFailedUrl.equals(sArtworkUrl) || !isNetworkConnected(this))) {
                artBmp = buildMissingCoverBitmap();
            }
            if (artBmp == null) {
                try {
                    artBmp = BitmapFactory.decodeResource(getResources(), R.drawable.ic_launcher);
                } catch (Throwable ignored) {
                }
            }
            MediaMetadata.Builder meta = new MediaMetadata.Builder()
                    .putString(MediaMetadata.METADATA_KEY_TITLE, sTitle != null && !sTitle.isEmpty() ? sTitle : "pMusic")
                    .putString(MediaMetadata.METADATA_KEY_ARTIST, sArtist != null ? sArtist : "")
                    .putString(MediaMetadata.METADATA_KEY_ALBUM, sAlbum != null && !sAlbum.isEmpty() ? sAlbum : "pMusic")
                    .putLong(MediaMetadata.METADATA_KEY_DURATION, sDurationMs);
            if (artBmp != null) {
                meta.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, artBmp);
                meta.putBitmap(MediaMetadata.METADATA_KEY_ART, artBmp);
                meta.putBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON, artBmp);
            }
            sMediaSession.setMetadata(meta.build());

            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (Build.VERSION.SDK_INT >= 26 && nm != null) {
                NotificationChannel ch = new NotificationChannel(
                        CHANNEL_ID,
                        "Reproducci\\u00f3n pMusic",
                        NotificationManager.IMPORTANCE_LOW
                );
                ch.setSound(null, null);
                ch.setShowBadge(false);
                ch.enableVibration(false);
                ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
                nm.createNotificationChannel(ch);
            }

            Intent launchIntent = new Intent(this, MainActivity.class);
            launchIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            int piFlags = Build.VERSION.SDK_INT >= 23
                    ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                    : PendingIntent.FLAG_UPDATE_CURRENT;
            PendingIntent contentPi = PendingIntent.getActivity(this, 0, launchIntent, piFlags);

            Notification.Builder builder = Build.VERSION.SDK_INT >= 26
                    ? new Notification.Builder(this, CHANNEL_ID)
                    : new Notification.Builder(this);

            Notification.MediaStyle mediaStyle = new Notification.MediaStyle()
                    .setMediaSession(sMediaSession.getSessionToken())
                    .setShowActionsInCompactView(1, 2, 3);

            builder.setContentTitle(sTitle != null && !sTitle.isEmpty() ? sTitle : "pMusic")
                    .setContentText(sArtist != null && !sArtist.isEmpty() ? sArtist : "pMusic Audio")
                    .setSubText("pMusic")
                    .setSmallIcon(R.drawable.ic_stat_pmusic)
                    .setColor(0xFF070709)
                    .setContentIntent(contentPi)
                    .setOngoing(sIsPlaying)
                    .setOnlyAlertOnce(true)
                    .setVisibility(Notification.VISIBILITY_PUBLIC)
                    .addAction(shuffleIconRes, shuffleLabel, makeServiceActionIntent(ACTION_SHUFFLE, 9))
                    .addAction(R.drawable.ic_media_prev, "Anterior", makeServiceActionIntent(ACTION_PREV, 10))
                    .addAction(
                            sIsPlaying ? R.drawable.ic_media_pause : R.drawable.ic_media_play,
                            sIsPlaying ? "Pausar" : "Reproducir",
                            makeServiceActionIntent(ACTION_TOGGLE, 11)
                    )
                    .addAction(R.drawable.ic_media_next, "Siguiente", makeServiceActionIntent(ACTION_NEXT, 12))
                    .addAction(repeatIconRes, repeatLabel, makeServiceActionIntent(ACTION_REPEAT, 13))
                    .setStyle(mediaStyle);
            if (Build.VERSION.SDK_INT >= 26) {
                builder.setColorized(true);
            }

            if (artBmp != null) {
                builder.setLargeIcon(artBmp);
            }
            Notification notif = builder.build();
            startForeground(NOTIFICATION_ID, notif);
            if (nm != null) {
                nm.notify(NOTIFICATION_ID, notif);
            }
            PMusicWidgetProvider.updateAllWidgets(this, sTitle, sArtist, sIsPlaying, artBmp);
            PMusicCompactWidgetProvider.updateAllWidgets(this, sTitle, sArtist, sIsPlaying, artBmp);
            PMusicRecentWidgetProvider.updateAllWidgets(this, sTitle, sArtist, sIsPlaying, artBmp);
            PMusicCoverWidgetProvider.updateAllWidgets(this, sTitle, sArtist, sIsPlaying, artBmp);
        } catch (Throwable ignored) {
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        sServiceInstance = this;
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        if (pm != null) {
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "pMusic::PlaybackWakeLock");
            wakeLock.setReferenceCounted(false);
        }
        try {
            WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wm != null) {
                wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "pMusic::PlaybackWifiLock");
                wifiLock.setReferenceCounted(false);
            }
        } catch (Throwable ignored) {
        }
        try {
            noisyReceiver = new BroadcastReceiver() {
                @Override
                public void onReceive(Context context, Intent intent) {
                    if (intent != null && AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(intent.getAction())) {
                        sIsPlaying = false;
                        MainActivity.dispatchMediaAction(PMusicPlaybackService.this, "pause", -1);
                        syncMediaSessionAndNotification(true);
                    }
                }
            };
            IntentFilter noisyFilter = new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY);
            if (Build.VERSION.SDK_INT >= 33) {
                registerReceiver(noisyReceiver, noisyFilter, Context.RECEIVER_EXPORTED);
            } else {
                registerReceiver(noisyReceiver, noisyFilter);
            }
            noisyRegistered = true;
        } catch (Throwable ignored) {
        }
        syncMediaSessionAndNotification();
    }

    // WebView owns Android AudioFocus natively for HTMLAudio/WebAudio; do not steal focus from it here.
    private void updateLocks(boolean playing) {
        try {
            if (playing) {
                if (wakeLock != null && !wakeLock.isHeld()) {
                    wakeLock.acquire(6 * 60 * 60 * 1000L);
                }
                if (wifiLock != null && !wifiLock.isHeld()) {
                    wifiLock.acquire();
                }
            } else {
                if (wifiLock != null && wifiLock.isHeld()) {
                    wifiLock.release();
                }
            }
        } catch (Throwable ignored) {
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        sServiceInstance = this;
        updateLocks(sIsPlaying || intent == null || !ACTION_STOP.equals(intent.getAction()));
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_SHUFFLE.equals(action)) {
            sShuffleEnabled = !sShuffleEnabled;
            MainActivity.dispatchMediaAction(this, "shuffle", -1);
        } else if (ACTION_PREV.equals(action)) {
            MainActivity.dispatchMediaAction(this, "previoustrack", -1);
        } else if (ACTION_TOGGLE.equals(action)) {
            MainActivity.dispatchMediaAction(this, "toggle", -1);
        } else if (ACTION_NEXT.equals(action)) {
            MainActivity.dispatchMediaAction(this, "nexttrack", -1);
        } else if (ACTION_REPEAT.equals(action)) {
            sRepeatMode = "off".equals(sRepeatMode) ? "all" : "all".equals(sRepeatMode) ? "one" : "off";
            MainActivity.dispatchMediaAction(this, "repeat", -1);
        } else if (ACTION_STOP.equals(action)) {
            MainActivity.dispatchMediaAction(this, "pause", -1);
        }
        syncMediaSessionAndNotification();
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        if (sServiceInstance == this) {
            sServiceInstance = null;
        }
        if (noisyRegistered && noisyReceiver != null) {
            try {
                unregisterReceiver(noisyReceiver);
            } catch (Throwable ignored) {
            }
            noisyRegistered = false;
        }
        try {
            stopForeground(true);
        } catch (Throwable ignored) {
        }
        if (wifiLock != null && wifiLock.isHeld()) {
            wifiLock.release();
        }
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
`,
  'utf-8'
);

writeFileSync(
  resolve(javaSrcDir, 'PMusicMediaBrowserService.java'),
  `package es.pmusic.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.media.MediaDescription;
import android.media.browse.MediaBrowser;
import android.net.Uri;
import android.os.Bundle;
import android.service.media.MediaBrowserService;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

public class PMusicMediaBrowserService extends MediaBrowserService {
    private static final String ROOT_ID = "pmusic_root";
    private static final String NODE_RECENTS = "folder_recents";
    private static final String NODE_PLAYLISTS = "folder_playlists";
    private static final String NODE_LIKED = "folder_liked";
    private static volatile PMusicMediaBrowserService sBrowserInstance;

    public static void notifyDataChanged() {
        PMusicMediaBrowserService inst = sBrowserInstance;
        if (inst != null) {
            try {
                inst.notifyChildrenChanged(ROOT_ID);
                inst.notifyChildrenChanged(NODE_RECENTS);
                inst.notifyChildrenChanged(NODE_PLAYLISTS);
                inst.notifyChildrenChanged(NODE_LIKED);
            } catch (Throwable ignored) {
            }
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        sBrowserInstance = this;
        setSessionToken(PMusicPlaybackService.getOrCreateSessionToken(this));
    }

    @Override
    public void onDestroy() {
        if (sBrowserInstance == this) {
            sBrowserInstance = null;
        }
        super.onDestroy();
    }

    @Override
    public BrowserRoot onGetRoot(String clientPackageName, int clientUid, Bundle rootHints) {
        Bundle extras = new Bundle();
        extras.putBoolean("android.media.browse.CONTENT_STYLE_SUPPORTED", true);
        extras.putInt("android.media.browse.CONTENT_STYLE_BROWSABLE_HINT", 1);
        extras.putInt("android.media.browse.CONTENT_STYLE_PLAYABLE_HINT", 1);
        return new BrowserRoot(ROOT_ID, extras);
    }

    @Override
    public void onLoadChildren(String parentId, Result<List<MediaBrowser.MediaItem>> result) {
        List<MediaBrowser.MediaItem> items = new ArrayList<MediaBrowser.MediaItem>();
        if (ROOT_ID.equals(parentId)) {
            items.add(makeFolder(NODE_RECENTS, "Para ti y recientes", "Reproducci\\u00f3n r\\u00e1pida"));
            items.add(makeFolder(NODE_PLAYLISTS, "Tus playlists", "Toca para reproducir"));
            items.add(makeFolder(NODE_LIKED, "Me gusta", "Tus canciones favoritas"));
            result.sendResult(items);
            return;
        }

        SharedPreferences sp = getSharedPreferences("pmusic_car_lib", Context.MODE_PRIVATE);
        String raw = sp.getString("json", "{}");
        try {
            JSONObject root = new JSONObject(raw);
            if (NODE_RECENTS.equals(parentId)) {
                appendTracks(items, root.optJSONArray("recents"));
            } else if (NODE_LIKED.equals(parentId)) {
                appendTracks(items, root.optJSONArray("liked"));
            } else if (NODE_PLAYLISTS.equals(parentId)) {
                JSONArray pls = root.optJSONArray("playlists");
                if (pls != null) {
                    for (int i = 0; i < pls.length(); i++) {
                        JSONObject p = pls.optJSONObject(i);
                        if (p == null) continue;
                        String id = "playlist:" + p.optString("id", "");
                        String title = p.optString("name", "Playlist");
                        int count = p.optInt("count", 0);
                        String art = p.optString("art", "");
                        MediaDescription.Builder db = new MediaDescription.Builder()
                                .setMediaId(id)
                                .setTitle(title)
                                .setSubtitle(count + " canciones");
                        if (!art.isEmpty()) {
                            db.setIconUri(Uri.parse(art));
                        }
                        items.add(new MediaBrowser.MediaItem(db.build(), MediaBrowser.MediaItem.FLAG_PLAYABLE));
                    }
                }
            }
        } catch (Throwable ignored) {
        }
        result.sendResult(items);
    }

    private void appendTracks(List<MediaBrowser.MediaItem> out, JSONArray arr) {
        if (arr == null) return;
        for (int i = 0; i < arr.length(); i++) {
            JSONObject t = arr.optJSONObject(i);
            if (t == null) continue;
            String id = "track:" + t.optString("id", "");
            String title = t.optString("title", "Canci\\u00f3n");
            String artist = t.optString("artist", "pMusic");
            String art = t.optString("art", "");
            MediaDescription.Builder db = new MediaDescription.Builder()
                    .setMediaId(id)
                    .setTitle(title)
                    .setSubtitle(artist);
            if (!art.isEmpty()) {
                db.setIconUri(Uri.parse(art));
            }
            out.add(new MediaBrowser.MediaItem(db.build(), MediaBrowser.MediaItem.FLAG_PLAYABLE));
        }
    }

    private MediaBrowser.MediaItem makeFolder(String id, String title, String subtitle) {
        MediaDescription desc = new MediaDescription.Builder()
                .setMediaId(id)
                .setTitle(title)
                .setSubtitle(subtitle)
                .build();
        return new MediaBrowser.MediaItem(desc, MediaBrowser.MediaItem.FLAG_BROWSABLE);
    }
}
`,
  'utf-8'
);

writeFileSync(
  resolve(javaSrcDir, 'MainActivity.java'),
  `package es.pmusic.app;

import android.app.Activity;
import android.app.UiModeManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.speech.RecognizerIntent;
import android.view.HapticFeedbackConstants;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

public class MainActivity extends Activity {
    private static final String NATIVE_APP_VERSION = "0.24.9";
    private volatile File activeOtaDir = null;

    private static int compareSemverNative(String a, String b) {
        String[] pa = (a == null ? "" : a.trim().replaceFirst("^[vV]", "")).split("-")[0].split("\\\\.");
        String[] pb = (b == null ? "" : b.trim().replaceFirst("^[vV]", "")).split("-")[0].split("\\\\.");
        int len = Math.max(Math.max(pa.length, pb.length), 3);
        for (int i = 0; i < len; i++) {
            int va = 0;
            int vb = 0;
            try { if (i < pa.length && !pa[i].isEmpty()) va = Integer.parseInt(pa[i]); } catch (Exception ignored) {}
            try { if (i < pb.length && !pb[i].isEmpty()) vb = Integer.parseInt(pb[i]); } catch (Exception ignored) {}
            if (va > vb) return 1;
            if (va < vb) return -1;
        }
        return 0;
    }

    private static void deleteRecursive(File target) {
        if (target == null || !target.exists()) return;
        File[] children = target.listFiles();
        if (children != null) {
            for (File child : children) {
                deleteRecursive(child);
            }
        }
        try {
            target.delete();
        } catch (Throwable ignored) {
        }
    }

    private void refreshActiveOtaDir() {
        try {
            File currentDir = new File(getFilesDir(), "ota_web/current");
            File idx = new File(currentDir, "index.html");
            File verFile = new File(currentDir, "ota-version.txt");
            if (idx.exists() && idx.isFile() && verFile.exists() && verFile.isFile()) {
                byte[] buf = new byte[(int) Math.min(64L, verFile.length())];
                FileInputStream fis = new FileInputStream(verFile);
                int r = fis.read(buf);
                fis.close();
                String otaVer = r > 0 ? new String(buf, 0, r, StandardCharsets.UTF_8).trim() : "";
                if (!otaVer.isEmpty() && compareSemverNative(otaVer, NATIVE_APP_VERSION) >= 0) {
                    activeOtaDir = currentDir;
                    return;
                }
            }
        } catch (Throwable ignored) {
        }
        activeOtaDir = null;
    }
    private static final int REQ_VOICE_SEARCH = 4102;
    private static volatile MainActivity sInstance;
    private static volatile String sPendingMediaAction = null;
    private static volatile double sPendingMediaSeek = -1;
    private static volatile String sPendingCarSearch = null;
    private static volatile String sPendingCarMediaId = null;
    private static volatile String sPendingReleaseJson = null;
    private static volatile String sPendingWidgetOpenJson = null;

    private static final String YT_IOS_UA = "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)";
    private static final String YT_WEB_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
    private static final long STREAM_CACHE_TTL_MS = 35L * 60L * 1000L;
    private static final Pattern YT_ID_PATTERN = Pattern.compile("^[a-zA-Z0-9_-]{11}$");
    private static final Pattern HARD_UNWANTED_PATTERN = Pattern.compile("\\\\b(karaoke|instrumental|acapella|a capella|cover|ai cover|reaction|sped up|slowed|nightcore|8d audio|8d|reverb|bass boosted|tutorial|letra|lyrics|parodia|parody|tribute|pitched|karaoke version|instrumental version)\\\\b");
    private static final Pattern REMIX_PATTERN = Pattern.compile("\\\\b(remix|rmx|vip mix|club mix|extended mix|mashup|bootleg|flip|rework|refix)\\\\b");
    private static final Pattern LIVE_PATTERN = Pattern.compile("\\\\b(live|en vivo|directo|acustico|acoustic|unplugged|tiny desk|session|sesiones)\\\\b");
    private static final Pattern TITLE_NOISE_PATTERN = Pattern.compile("\\\\((?:feat\\\\.|ft\\\\.|with|prod\\\\.|official|video|audio|lyric|en vivo|live).*?\\\\)|\\\\[(?:official|video|audio|lyric|hd|4k).*?\\\\]", Pattern.CASE_INSENSITIVE);
    private static final Pattern DURATION_TOKEN_PATTERN = Pattern.compile("^\\\\d{1,2}:\\\\d{2}(?::\\\\d{2})?$");
    private static final Pattern OPEN_RANGE_PATTERN = Pattern.compile("^bytes=(\\\\d+)-$");

    private static boolean hasDisallowedVersion(String targetTitle, String candidateText) {
        String candNorm = normText(candidateText);
        if (candNorm.isEmpty()) return false;
        String targetNorm = normText(targetTitle);
        if (HARD_UNWANTED_PATTERN.matcher(candNorm).find() && !HARD_UNWANTED_PATTERN.matcher(targetNorm).find()) {
            return true;
        }
        if (REMIX_PATTERN.matcher(candNorm).find() && !REMIX_PATTERN.matcher(targetNorm).find()) {
            return true;
        }
        if (LIVE_PATTERN.matcher(candNorm).find() && !LIVE_PATTERN.matcher(targetNorm).find()) {
            return true;
        }
        return false;
    }

    private static final class ResolvedStream {
        final String url;
        final String mime;
        final String userAgent;
        final long expiresAtMs;
        final String codec;
        final long bitrate;
        final boolean isAdaptiveAudio;

        ResolvedStream(String url, String mime, String userAgent, long expiresAtMs) {
            this(url, mime, userAgent, expiresAtMs, "", 0L, false);
        }

        ResolvedStream(String url, String mime, String userAgent, long expiresAtMs, String codec, long bitrate, boolean isAdaptiveAudio) {
            this.url = url;
            this.mime = mime;
            this.userAgent = userAgent;
            this.expiresAtMs = expiresAtMs;
            this.codec = codec != null ? codec : "";
            this.bitrate = bitrate;
            this.isAdaptiveAudio = isAdaptiveAudio;
        }
    }

    private static String normalizeStreamQuality(String rawQuality) {
        if ("low".equalsIgnoreCase(rawQuality)) return "low";
        if ("medium".equalsIgnoreCase(rawQuality)) return "medium";
        if ("auto".equalsIgnoreCase(rawQuality)) return "auto";
        return "high";
    }

    private static final class Candidate {
        final String videoId;
        final int score;

        Candidate(String videoId, int score) {
            this.videoId = videoId;
            this.score = score;
        }
    }

    private static final class HttpStreamWrapper extends InputStream {
        private final HttpURLConnection conn;
        private final InputStream delegate;

        HttpStreamWrapper(HttpURLConnection conn, InputStream delegate) {
            this.conn = conn;
            this.delegate = delegate;
        }

        @Override
        public int read() throws IOException {
            return delegate.read();
        }

        @Override
        public int read(byte[] b) throws IOException {
            return delegate.read(b);
        }

        @Override
        public int read(byte[] b, int off, int len) throws IOException {
            return delegate.read(b, off, len);
        }

        @Override
        public long skip(long n) throws IOException {
            return delegate.skip(n);
        }

        @Override
        public int available() throws IOException {
            return delegate.available();
        }

        @Override
        public void close() throws IOException {
            try {
                delegate.close();
            } finally {
                conn.disconnect();
            }
        }
    }

    private WebView webView;
    private String pendingAuthCallbackUrl = null;
    private int safeInsetTopDp = 0;
    private int safeInsetBottomDp = 0;
    private boolean lastDarkStatusIcons = false;
    private boolean lastDarkNavIcons = false;
    private String lastStatusBarHex = "#070709";
    private String lastNavBarHex = "#070709";
    private ServerSocket localStreamServer = null;
    private volatile int localStreamPort = 0;
    private volatile boolean streamServerRunning = false;
    private final ExecutorService streamExecutor = Executors.newCachedThreadPool();
    private final Object streamCacheLock = new Object();
    private volatile long ytBotCooldownUntilMs = 0L;
    private String lastStreamId;
    private byte[] lastStreamBytes;
    private String lastStreamMime;
    private final Map<String, ResolvedStream> fullStreamCache = new LinkedHashMap<String, ResolvedStream>(32, 0.75f, true) {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, ResolvedStream> eldest) {
            return size() > 24;
        }
    };
    private final Map<String, Object> keyLocks = new HashMap<String, Object>();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        sInstance = this;
        if (Build.VERSION.SDK_INT >= 33) {
            try {
                if (checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) {
                    requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 4101);
                }
            } catch (Exception ignored) {
            }
        }

        Window window = getWindow();
        if (window != null && Build.VERSION.SDK_INT >= 21) {
            window.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS | WindowManager.LayoutParams.FLAG_TRANSLUCENT_NAVIGATION);
            window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
            window.setStatusBarColor(Color.TRANSPARENT);
            window.setNavigationBarColor(Color.TRANSPARENT);
            if (Build.VERSION.SDK_INT >= 28) {
                WindowManager.LayoutParams lp = window.getAttributes();
                lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
                window.setAttributes(lp);
            }
            if (Build.VERSION.SDK_INT >= 29) {
                window.setStatusBarContrastEnforced(false);
                window.setNavigationBarContrastEnforced(false);
            }
            if (Build.VERSION.SDK_INT >= 30) {
                window.setDecorFitsSystemWindows(false);
            } else {
                window.getDecorView().setSystemUiVisibility(
                        View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                );
            }
        }

        if (window != null) {
            window.setBackgroundDrawable(new android.graphics.drawable.ColorDrawable(Color.BLACK));
        }
        webView = new WebView(this) {
            @Override
            protected void onWindowVisibilityChanged(int visibility) {
                if (PMusicPlaybackService.isCurrentlyPlaying()) {
                    super.onWindowVisibilityChanged(View.VISIBLE);
                } else {
                    super.onWindowVisibilityChanged(visibility);
                }
            }
        };
        webView.setBackgroundColor(Color.BLACK);
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        if (Build.VERSION.SDK_INT >= 26) {
            try {
                webView.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
            } catch (Exception ignored) {
            }
        }
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        if (Build.VERSION.SDK_INT >= 20) {
            webView.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
                @Override
                public WindowInsets onApplyWindowInsets(View v, WindowInsets insets) {
                    float density = getResources().getDisplayMetrics().density;
                    if (density <= 0f) density = 1f;
                    int topPx;
                    int bottomPx;
                    if (Build.VERSION.SDK_INT >= 30) {
                        android.graphics.Insets sys = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                        topPx = sys.top;
                        bottomPx = sys.bottom;
                    } else {
                        topPx = insets.getSystemWindowInsetTop();
                        bottomPx = insets.getSystemWindowInsetBottom();
                    }
                    safeInsetTopDp = Math.max(0, Math.round(topPx / density));
                    safeInsetBottomDp = Math.max(0, Math.round(bottomPx / density));
                    injectSafeAreaInsets();
                    return insets;
                }
            });
        }

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        if (Build.VERSION.SDK_INT >= 17) {
            settings.setMediaPlaybackRequiresUserGesture(false);
        }
        if (Build.VERSION.SDK_INT >= 21) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }

        webView.setWebChromeClient(new WebChromeClient());
        webView.addJavascriptInterface(new Object() {
            @android.webkit.JavascriptInterface
            public void openExternalUrl(final String url) {
                if (url == null || (!url.startsWith("https://") && !url.startsWith("http://"))) return;
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        try {
                            Intent browserIntent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                            browserIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                            startActivity(browserIntent);
                        } catch (Exception ignored) {
                        }
                    }
                });
            }

            @android.webkit.JavascriptInterface
            public String consumePendingAuthCallback() {
                String val = pendingAuthCallbackUrl;
                pendingAuthCallbackUrl = null;
                return val != null ? val : "";
            }

            @android.webkit.JavascriptInterface
            public String getStreamBaseUrl() {
                return localStreamPort > 0 ? ("http://127.0.0.1:" + localStreamPort) : "";
            }

            @android.webkit.JavascriptInterface
            public void updateMediaSession(final String json) {
                try {
                    PMusicPlaybackService.updateFromJson(MainActivity.this, json);
                } catch (Exception ignored) {
                }
            }

            @android.webkit.JavascriptInterface
            public void saveOfflineCover(final String trackId, final String coverUrl) {
                if (trackId == null || trackId.trim().isEmpty() || coverUrl == null || !coverUrl.startsWith("https://")) return;
                streamExecutor.execute(new Runnable() {
                    @Override
                    public void run() {
                        HttpURLConnection conn = null;
                        try {
                            URL u = new URL(coverUrl);
                            conn = (HttpURLConnection) u.openConnection();
                            conn.setConnectTimeout(5000);
                            conn.setReadTimeout(6000);
                            conn.setInstanceFollowRedirects(true);
                            conn.setRequestProperty("User-Agent", "pMusic-Android/0.23.0");
                            if (conn.getResponseCode() >= 200 && conn.getResponseCode() < 300) {
                                InputStream in = conn.getInputStream();
                                ByteArrayOutputStream bos = new ByteArrayOutputStream();
                                byte[] buf = new byte[8192];
                                int n;
                                while ((n = in.read(buf)) != -1) bos.write(buf, 0, n);
                                in.close();
                                PMusicPlaybackService.saveOfflineCoverBytes(getApplicationContext(), trackId.trim(), bos.toByteArray());
                            }
                        } catch (Throwable ignored) {
                        } finally {
                            if (conn != null) conn.disconnect();
                        }
                    }
                });
            }

            @android.webkit.JavascriptInterface
            public String getNativeVersion() {
                return NATIVE_APP_VERSION;
            }

            @android.webkit.JavascriptInterface
            public boolean downloadAndInstallOtaBundle(final String zipUrl, final String version) {
                if (zipUrl == null || !zipUrl.startsWith("https://") || version == null || version.trim().isEmpty()) {
                    return false;
                }
                final String safeVer = version.trim().replaceAll("[^0-9A-Za-z._-]", "");
                streamExecutor.execute(new Runnable() {
                    @Override
                    public void run() {
                        HttpURLConnection conn = null;
                        try {
                            URL u = new URL(zipUrl);
                            conn = (HttpURLConnection) u.openConnection();
                            conn.setConnectTimeout(6000);
                            conn.setReadTimeout(20000);
                            conn.setInstanceFollowRedirects(true);
                            conn.setRequestProperty("User-Agent", "pMusic-Updater/" + NATIVE_APP_VERSION);
                            if (conn.getResponseCode() < 200 || conn.getResponseCode() >= 300) return;
                            int total = Math.max(1024, conn.getContentLength());
                            File outZip = new File(getCacheDir(), "pmusic-ota.zip");
                            FileOutputStream fos = new FileOutputStream(outZip);
                            InputStream in = conn.getInputStream();
                            byte[] buf = new byte[16384];
                            long received = 0L;
                            int n;
                            long lastReport = 0L;
                            while ((n = in.read(buf)) != -1) {
                                fos.write(buf, 0, n);
                                received += n;
                                long now = System.currentTimeMillis();
                                if (now - lastReport > 110L) {
                                    lastReport = now;
                                    final int pct = (int) Math.min(88L, Math.max(10L, (received * 86L) / total));
                                    runOnUiThread(new Runnable() {
                                        @Override
                                        public void run() {
                                            if (webView != null) {
                                                webView.evaluateJavascript("window.__pmusicUpdateProgress&&window.__pmusicUpdateProgress(" + pct + ",'Actualización v" + safeVer + " · Descargando " + pct + "%…')", null);
                                            }
                                        }
                                    });
                                }
                            }
                            in.close();
                            fos.close();

                            runOnUiThread(new Runnable() {
                                @Override
                                public void run() {
                                    if (webView != null) {
                                        webView.evaluateJavascript("window.__pmusicUpdateProgress&&window.__pmusicUpdateProgress(92,'Actualización v" + safeVer + " · Instalando…')", null);
                                    }
                                }
                            });

                            File otaBase = new File(getFilesDir(), "ota_web");
                            File staging = new File(otaBase, "staging");
                            File current = new File(otaBase, "current");
                            deleteRecursive(staging);
                            staging.mkdirs();
                            String canonicalRoot = staging.getCanonicalPath() + File.separator;

                            ZipInputStream zis = new ZipInputStream(new FileInputStream(outZip));
                            ZipEntry entry;
                            byte[] zbuf = new byte[16384];
                            while ((entry = zis.getNextEntry()) != null) {
                                String entryName = entry.getName();
                                if (entryName == null || entryName.isEmpty()) {
                                    zis.closeEntry();
                                    continue;
                                }
                                File destFile = new File(staging, entryName);
                                String canonicalDest = destFile.getCanonicalPath();
                                if (!canonicalDest.startsWith(canonicalRoot)) {
                                    zis.closeEntry();
                                    continue;
                                }
                                if (entry.isDirectory()) {
                                    destFile.mkdirs();
                                } else {
                                    File parent = destFile.getParentFile();
                                    if (parent != null) parent.mkdirs();
                                    FileOutputStream efos = new FileOutputStream(destFile);
                                    int rn;
                                    while ((rn = zis.read(zbuf)) != -1) {
                                        efos.write(zbuf, 0, rn);
                                    }
                                    efos.close();
                                }
                                zis.closeEntry();
                            }
                            zis.close();

                            if (new File(staging, "index.html").exists()) {
                                FileOutputStream vfos = new FileOutputStream(new File(staging, "ota-version.txt"));
                                vfos.write(safeVer.getBytes(StandardCharsets.UTF_8));
                                vfos.close();
                                deleteRecursive(current);
                                if (!staging.renameTo(current)) {
                                    current.mkdirs();
                                }
                                refreshActiveOtaDir();
                                runOnUiThread(new Runnable() {
                                    @Override
                                    public void run() {
                                        if (webView != null) {
                                            webView.evaluateJavascript("window.__pmusicUpdateProgress&&window.__pmusicUpdateProgress(100,'Actualización v" + safeVer + " instalada · Cargando…')", null);
                                            webView.postDelayed(new Runnable() {
                                                @Override
                                                public void run() {
                                                    if (webView != null) {
                                                        webView.clearCache(true);
                                                        webView.loadUrl("https://appassets.pmusic.local/index.html?ota=" + Uri.encode(safeVer));
                                                    }
                                                }
                                            }, 220L);
                                        }
                                    }
                                });
                            }
                        } catch (Throwable ignored) {
                        } finally {
                            if (conn != null) conn.disconnect();
                        }
                    }
                });
                return true;
            }

            @android.webkit.JavascriptInterface
            public boolean downloadAndInstallUpdate(final String apkUrl, final String version) {
                if (apkUrl == null || !apkUrl.startsWith("https://")) return false;
                streamExecutor.execute(new Runnable() {
                    @Override
                    public void run() {
                        HttpURLConnection conn = null;
                        try {
                            URL u = new URL(apkUrl);
                            conn = (HttpURLConnection) u.openConnection();
                            conn.setConnectTimeout(6000);
                            conn.setReadTimeout(20000);
                            conn.setInstanceFollowRedirects(true);
                            conn.setRequestProperty("User-Agent", "pMusic-Updater/0.23.0");
                            if (conn.getResponseCode() < 200 || conn.getResponseCode() >= 300) return;
                            int total = Math.max(1024, conn.getContentLength());
                            File outApk = new File(getCacheDir(), "pmusic-update.apk");
                            FileOutputStream fos = new FileOutputStream(outApk);
                            InputStream in = conn.getInputStream();
                            byte[] buf = new byte[16384];
                            long received = 0L;
                            int n;
                            long lastReport = 0L;
                            while ((n = in.read(buf)) != -1) {
                                fos.write(buf, 0, n);
                                received += n;
                                long now = System.currentTimeMillis();
                                if (now - lastReport > 140L) {
                                    lastReport = now;
                                    final int pct = (int) Math.min(96L, Math.max(8L, (received * 95L) / total));
                                    runOnUiThread(new Runnable() {
                                        @Override
                                        public void run() {
                                            if (webView != null) {
                                                webView.evaluateJavascript("window.__pmusicUpdateProgress&&window.__pmusicUpdateProgress(" + pct + ",'Actualizando pMusic…')", null);
                                            }
                                        }
                                    });
                                }
                            }
                            in.close();
                            fos.close();
                            final Uri apkUri = Uri.parse("content://es.pmusic.app.fileprovider/update/pmusic-update.apk");
                            runOnUiThread(new Runnable() {
                                @Override
                                public void run() {
                                    if (webView != null) {
                                        webView.evaluateJavascript("window.__pmusicUpdateProgress&&window.__pmusicUpdateProgress(100,'Abriendo instalador…')", null);
                                    }
                                    try {
                                        Intent install = new Intent(Intent.ACTION_VIEW);
                                        install.setDataAndType(apkUri, "application/vnd.android.package-archive");
                                        install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                                        startActivity(install);
                                    } catch (Throwable ignored) {
                                    }
                                }
                            });
                        } catch (Throwable ignored) {
                        } finally {
                            if (conn != null) conn.disconnect();
                        }
                    }
                });
                return true;
            }

            @android.webkit.JavascriptInterface
            public void syncCarLibrary(final String json) {
                try {
                    SharedPreferences prefs = getSharedPreferences("pmusic_car_lib", Context.MODE_PRIVATE);
                    prefs.edit().putString("json", json != null ? json : "{}").apply();
                    PMusicMediaBrowserService.notifyDataChanged();
                } catch (Exception ignored) {
                }
            }

            @android.webkit.JavascriptInterface
            public boolean startVoiceSearch() {
                try {
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            try {
                                Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "es-ES");
                                intent.putExtra(RecognizerIntent.EXTRA_PROMPT, "Di una canción o artista en pMusic");
                                startActivityForResult(intent, REQ_VOICE_SEARCH);
                            } catch (Exception ignored) {
                            }
                        }
                    });
                    return true;
                } catch (Exception ignored) {
                    return false;
                }
            }

            @android.webkit.JavascriptInterface
            public void setImmersiveFullscreen(final boolean enabled) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        Window w = getWindow();
                        if (w == null) return;
                        if (Build.VERSION.SDK_INT >= 30) {
                            android.view.WindowInsetsController ctrl = w.getInsetsController();
                            if (ctrl != null) {
                                if (enabled) {
                                    ctrl.hide(WindowInsets.Type.systemBars());
                                    ctrl.setSystemBarsBehavior(android.view.WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                                } else {
                                    ctrl.show(WindowInsets.Type.systemBars());
                                }
                            }
                        } else {
                            int baseFlags = View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION;
                            if (enabled) {
                                baseFlags |= View.SYSTEM_UI_FLAG_FULLSCREEN
                                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY;
                            }
                            w.getDecorView().setSystemUiVisibility(baseFlags);
                        }
                    }
                });
            }

            @android.webkit.JavascriptInterface
            public void triggerHaptic(final String style) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        if (webView == null) return;
                        try {
                            int code;
                            if ("confirm".equals(style)) {
                                code = Build.VERSION.SDK_INT >= 30
                                        ? HapticFeedbackConstants.CONFIRM
                                        : HapticFeedbackConstants.VIRTUAL_KEY;
                            } else if ("medium".equals(style)) {
                                code = Build.VERSION.SDK_INT >= 23
                                        ? HapticFeedbackConstants.CONTEXT_CLICK
                                        : HapticFeedbackConstants.KEYBOARD_TAP;
                            } else {
                                code = Build.VERSION.SDK_INT >= 21
                                        ? HapticFeedbackConstants.CLOCK_TICK
                                        : HapticFeedbackConstants.KEYBOARD_TAP;
                            }
                            webView.performHapticFeedback(code, HapticFeedbackConstants.FLAG_IGNORE_GLOBAL_SETTING);
                        } catch (Throwable ignored) {
                        }
                    }
                });
            }

            @android.webkit.JavascriptInterface
            public void setSystemBarsAppearance(final boolean darkIcons, final String statusBarHex, final String navBarHex) {
                setSystemBarsSplitAppearance(darkIcons, darkIcons, statusBarHex, navBarHex);
            }

            @android.webkit.JavascriptInterface
            public void setSystemBarsSplitAppearance(final boolean darkStatusIcons, final boolean darkNavIcons, final String statusBarHex, final String navBarHex) {
                lastDarkStatusIcons = darkStatusIcons;
                lastDarkNavIcons = darkNavIcons;
                lastStatusBarHex = statusBarHex != null ? statusBarHex : "#070709";
                lastNavBarHex = navBarHex != null ? navBarHex : "#070709";
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        applySystemBarsAppearance(lastDarkStatusIcons, lastDarkNavIcons, lastStatusBarHex, lastNavBarHex);
                    }
                });
            }

            @android.webkit.JavascriptInterface
            public void updateWidgetRecents(final String itemsJson) {
                try {
                    final String safeJson = itemsJson != null ? itemsJson : "[]";
                    getApplicationContext()
                            .getSharedPreferences("pmusic_widget_recents", MODE_PRIVATE)
                            .edit()
                            .putString("items_json", safeJson)
                            .apply();
                    streamExecutor.execute(new Runnable() {
                        @Override
                        public void run() {
                            try {
                                org.json.JSONArray arr = new org.json.JSONArray(safeJson);
                                for (int i = 0; i < Math.min(4, arr.length()); i++) {
                                    org.json.JSONObject item = arr.optJSONObject(i);
                                    if (item == null) continue;
                                    String coverUrl = item.optString("coverUrl", "");
                                    if (!coverUrl.isEmpty() && PMusicRecentWidgetProvider.getCachedThumb(coverUrl) == null) {
                                        android.graphics.Bitmap bmp = PMusicReleaseCheckJobService.downloadBitmap(coverUrl);
                                        if (bmp != null) {
                                            PMusicRecentWidgetProvider.putCachedThumb(coverUrl, bmp);
                                        }
                                    }
                                }
                            } catch (Throwable ignored) {
                            }
                            PMusicRecentWidgetProvider.updateAllWidgets(
                                    getApplicationContext(),
                                    PMusicPlaybackService.getWidgetTitle(),
                                    PMusicPlaybackService.getWidgetArtist(),
                                    PMusicPlaybackService.isCurrentlyPlaying(),
                                    PMusicPlaybackService.getWidgetCoverBitmap()
                            );
                        }
                    });
                } catch (Throwable ignored) {
                }
            }

            @android.webkit.JavascriptInterface
            public void showReleaseNotification(final String title, final String body, final String trackId) {
                showReleaseNotificationDetailed(title, body, trackId, "", "");
            }

            @android.webkit.JavascriptInterface
            public void showReleaseNotificationDetailed(
                    final String title,
                    final String artistOrBody,
                    final String trackId,
                    final String albumId,
                    final String coverUrl
            ) {
                streamExecutor.execute(new Runnable() {
                    @Override
                    public void run() {
                        try {
                            android.graphics.Bitmap bmp = (coverUrl != null && coverUrl.startsWith("https://"))
                                    ? PMusicReleaseCheckJobService.downloadBitmap(coverUrl)
                                    : null;
                            String notifTitle = (title != null && !title.trim().isEmpty()) ? title.trim() : "Nuevo lanzamiento";
                            String notifBody = (artistOrBody != null && !artistOrBody.trim().isEmpty())
                                    ? artistOrBody.trim() + " · Toca para escuchar"
                                    : "Toca para escuchar en pMusic";
                            PMusicReleaseCheckJobService.postReleaseNotification(
                                    getApplicationContext(),
                                    notifTitle,
                                    notifBody,
                                    trackId != null ? trackId : "",
                                    albumId != null ? albumId : "",
                                    title != null ? title : "",
                                    artistOrBody != null ? artistOrBody : "",
                                    coverUrl != null ? coverUrl : "",
                                    bmp
                            );
                        } catch (Throwable ignored) {
                        }
                    }
                });
            }

            @android.webkit.JavascriptInterface
            public void syncFavoriteArtistsForReleases(final String json) {
                if (json == null || json.trim().isEmpty()) return;
                streamExecutor.execute(new Runnable() {
                    @Override
                    public void run() {
                        try {
                            org.json.JSONObject obj = new org.json.JSONObject(json);
                            boolean enabled = obj.optBoolean("enabled", true);
                            org.json.JSONArray artists = obj.optJSONArray("artists");
                            org.json.JSONArray seen = obj.optJSONArray("seenIds");
                            android.content.SharedPreferences prefs = getSharedPreferences("pmusic_release_prefs", Context.MODE_PRIVATE);
                            android.content.SharedPreferences.Editor ed = prefs.edit();
                            ed.putBoolean("enabled", enabled);
                            if (artists != null) {
                                ed.putString("favorite_artists_json", artists.toString());
                            }
                            if (seen != null) {
                                org.json.JSONArray existingSeen;
                                try {
                                    existingSeen = new org.json.JSONArray(prefs.getString("seen_release_ids", "[]"));
                                } catch (Exception e) {
                                    existingSeen = new org.json.JSONArray();
                                }
                                java.util.LinkedHashSet<String> merged = new java.util.LinkedHashSet<String>();
                                for (int i = 0; i < existingSeen.length(); i++) {
                                    String v = existingSeen.optString(i, "");
                                    if (!v.isEmpty()) merged.add(v);
                                }
                                for (int i = 0; i < seen.length(); i++) {
                                    String v = seen.optString(i, "");
                                    if (!v.isEmpty()) merged.add(v);
                                }
                                org.json.JSONArray outSeen = new org.json.JSONArray();
                                int skip = Math.max(0, merged.size() - 200);
                                int idx = 0;
                                for (String s : merged) {
                                    if (idx++ >= skip) outSeen.put(s);
                                }
                                ed.putString("seen_release_ids", outSeen.toString());
                            }
                            ed.apply();
                            PMusicReleaseCheckJobService.schedulePeriodicCheck(getApplicationContext(), enabled);
                        } catch (Throwable ignored) {
                        }
                    }
                });
            }

            @android.webkit.JavascriptInterface
            public String getAppVersion() {
                return NATIVE_APP_VERSION;
            }

            @android.webkit.JavascriptInterface
            public boolean isMeteredNetwork() {
                try {
                    android.net.ConnectivityManager cm =
                            (android.net.ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
                    return cm != null && cm.isActiveNetworkMetered();
                } catch (Throwable ignored) {
                    return false;
                }
            }
        }, "PMusicNative");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                injectSafeAreaInsets();
                if (pendingAuthCallbackUrl != null) {
                    dispatchAuthCallbackToJs(pendingAuthCallbackUrl);
                    pendingAuthCallbackUrl = null;
                }
                if (sPendingMediaAction != null) {
                    String act = sPendingMediaAction;
                    double seek = sPendingMediaSeek;
                    sPendingMediaAction = null;
                    sPendingMediaSeek = -1;
                    dispatchMediaActionToJs(act, seek);
                }
                if (sPendingCarSearch != null) {
                    String q = sPendingCarSearch;
                    sPendingCarSearch = null;
                    dispatchCarPlaySearchToJs(q);
                }
                if (sPendingCarMediaId != null) {
                    String mid = sPendingCarMediaId;
                    sPendingCarMediaId = null;
                    dispatchCarPlayMediaIdToJs(mid);
                }
                if (isCurrentlyInCarMode()) {
                    dispatchCarModeToJs(true);
                }
                if (sPendingReleaseJson != null) {
                    String rJson = sPendingReleaseJson;
                    sPendingReleaseJson = null;
                    dispatchReleaseTrackToJs(rJson);
                }
                if (sPendingWidgetOpenJson != null) {
                    String wJson = sPendingWidgetOpenJson;
                    sPendingWidgetOpenJson = null;
                    dispatchWidgetOpenToJs(wJson);
                }
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (uri == null) return null;
                String host = uri.getHost();
                String path = uri.getPath();
                if (path == null) path = "/";

                if ("appassets.pmusic.local".equalsIgnoreCase(host)) {
                    Map<String, String> corsHeaders = new HashMap<String, String>();
                    corsHeaders.put("Access-Control-Allow-Origin", "*");
                    corsHeaders.put("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
                    corsHeaders.put("Access-Control-Allow-Headers", "Range, Content-Type, Accept");
                    corsHeaders.put("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges, X-PMusic-Stream-Quality, X-PMusic-Stream-Codec, X-PMusic-Stream-Bitrate");

                    if ("/api/dz-proxy".equals(path)) {
                        String dzPath = uri.getQueryParameter("path");
                        if (dzPath == null || !dzPath.startsWith("/")) dzPath = "/chart/0/tracks?limit=25";
                        try {
                            byte[] jsonBytes = fetchRemoteBytes("https://api.deezer.com" + dzPath);
                            if (jsonBytes != null && jsonBytes.length > 2) {
                                return new WebResourceResponse(
                                        "application/json",
                                        "UTF-8",
                                        200,
                                        "OK",
                                        corsHeaders,
                                        new ByteArrayInputStream(jsonBytes)
                                );
                            }
                        } catch (Exception ignored) {
                        }
                        byte[] errBytes = "{\\"data\\":[]}".getBytes(StandardCharsets.UTF_8);
                        return new WebResourceResponse("application/json", "UTF-8", 200, "OK", corsHeaders, new ByteArrayInputStream(errBytes));
                    }

                    if ("/api/ytm-proxy".equals(path)) {
                        String ep = uri.getQueryParameter("ep");
                        String ytmBody = uri.getQueryParameter("body");
                        if (("search".equals(ep) || "browse".equals(ep) || "player".equals(ep)) && ytmBody != null && !ytmBody.isEmpty()) {
                            try {
                                String targetUrl = "player".equals(ep)
                                        ? "https://www.youtube.com/youtubei/v1/player?prettyPrint=false"
                                        : "https://music.youtube.com/youtubei/v1/" + ep + "?prettyPrint=false";
                                String targetOrigin = "player".equals(ep)
                                        ? "https://www.youtube.com"
                                        : "https://music.youtube.com";
                                byte[] ytmBytes = postJsonBytes(targetUrl, YT_WEB_UA, targetOrigin, ytmBody);
                                if (ytmBytes != null && ytmBytes.length > 2) {
                                    return new WebResourceResponse(
                                            "application/json",
                                            "UTF-8",
                                            200,
                                            "OK",
                                            corsHeaders,
                                            new ByteArrayInputStream(ytmBytes)
                                    );
                                }
                            } catch (Exception ignored) {
                            }
                        }
                        byte[] emptyYtm = "{}".getBytes(StandardCharsets.UTF_8);
                        return new WebResourceResponse("application/json", "UTF-8", 200, "OK", corsHeaders, new ByteArrayInputStream(emptyYtm));
                    }

                    if ("/api/radar-proxy".equals(path)) {
                        String targetUrl = uri.getQueryParameter("url");
                        if (targetUrl != null && (targetUrl.startsWith("https://open.spotify.com/embed/playlist/") || targetUrl.startsWith("https://www.lahiguera.net/musicalia/"))) {
                            HttpURLConnection conn = null;
                            try {
                                URL u = new URL(targetUrl);
                                conn = (HttpURLConnection) u.openConnection();
                                conn.setConnectTimeout(4000);
                                conn.setReadTimeout(4500);
                                conn.setInstanceFollowRedirects(true);
                                conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36");
                                if (conn.getResponseCode() >= 200 && conn.getResponseCode() < 300) {
                                    InputStream in = conn.getInputStream();
                                    ByteArrayOutputStream bos = new ByteArrayOutputStream();
                                    byte[] buf = new byte[8192];
                                    int n;
                                    while ((n = in.read(buf)) != -1) bos.write(buf, 0, n);
                                    in.close();
                                    return new WebResourceResponse("text/html", "UTF-8", 200, "OK", corsHeaders, new ByteArrayInputStream(bos.toByteArray()));
                                }
                            } catch (Throwable ignored) {
                            } finally {
                                if (conn != null) conn.disconnect();
                            }
                        }
                        byte[] emptyHtml = "".getBytes(StandardCharsets.UTF_8);
                        return new WebResourceResponse("text/html", "UTF-8", 404, "Not Found", corsHeaders, new ByteArrayInputStream(emptyHtml));
                    }

                    if ("/api/cover-proxy".equals(path)) {
                        String rawCover = uri.getQueryParameter("url");
                        if (rawCover != null && rawCover.startsWith("https://")) {
                            HttpURLConnection conn = null;
                            try {
                                URL u = new URL(rawCover);
                                conn = (HttpURLConnection) u.openConnection();
                                conn.setConnectTimeout(5000);
                                conn.setReadTimeout(6000);
                                conn.setInstanceFollowRedirects(true);
                                conn.setRequestProperty("User-Agent", "pMusic-Android/0.23.0");
                                if (conn.getResponseCode() >= 200 && conn.getResponseCode() < 300) {
                                    String ctype = conn.getContentType();
                                    if (ctype == null || !ctype.toLowerCase(Locale.ROOT).startsWith("image/")) {
                                        ctype = "image/jpeg";
                                    } else if (ctype.contains(";")) {
                                        ctype = ctype.substring(0, ctype.indexOf(';')).trim();
                                    }
                                    InputStream in = conn.getInputStream();
                                    ByteArrayOutputStream bos = new ByteArrayOutputStream();
                                    byte[] buf = new byte[8192];
                                    int n;
                                    while ((n = in.read(buf)) != -1) bos.write(buf, 0, n);
                                    in.close();
                                    return new WebResourceResponse(ctype, "binary", 200, "OK", corsHeaders, new ByteArrayInputStream(bos.toByteArray()));
                                }
                            } catch (Throwable ignored) {
                            } finally {
                                if (conn != null) conn.disconnect();
                            }
                        }
                        byte[] errImg = "{}".getBytes(StandardCharsets.UTF_8);
                        return new WebResourceResponse("application/json", "UTF-8", 502, "Bad Gateway", corsHeaders, new ByteArrayInputStream(errImg));
                    }

                    if (path.startsWith("/api/stream/")) {
                        String rawTrackId = Uri.decode(path.substring("/api/stream/".length()));
                        String qTitle = uri.getQueryParameter("title");
                        String qArtist = uri.getQueryParameter("artist");
                        String qQuality = normalizeStreamQuality(uri.getQueryParameter("quality"));
                        String qDurStr = uri.getQueryParameter("durationSec");
                        int qDurSec = 0;
                        if (qDurStr != null && !qDurStr.trim().isEmpty()) {
                            try {
                                qDurSec = Math.round(Float.parseFloat(qDurStr.trim()));
                            } catch (Exception ignored) {
                            }
                        }

                        String cacheKey = (rawTrackId != null ? rawTrackId : "") + "::" + (qTitle != null ? qTitle.trim() : "") + "::" + qQuality;
                        if ("1".equals(uri.getQueryParameter("fresh"))) {
                            synchronized (fullStreamCache) {
                                fullStreamCache.remove(cacheKey);
                            }
                        }
                        ResolvedStream fullStream = getOrResolveFullStream(cacheKey, rawTrackId, qTitle, qArtist, qDurSec, qQuality);
                        if (fullStream != null) {
                            WebResourceResponse ytResp = proxyStreamResponse(
                                    fullStream,
                                    cacheKey,
                                    rawTrackId,
                                    qTitle,
                                    qArtist,
                                    qDurSec,
                                    qQuality,
                                    corsHeaders,
                                    request.getRequestHeaders(),
                                    Build.VERSION.SDK_INT >= 21 ? request.getMethod() : "GET"
                            );
                            if (ytResp != null) return ytResp;
                        }

                        byte[] unavail = "{\\"error\\":\\"stream_unavailable\\"}".getBytes(StandardCharsets.UTF_8);
                        return new WebResourceResponse("application/json", "UTF-8", 503, "Service Unavailable", corsHeaders, new ByteArrayInputStream(unavail));
                    }

                    if (path.startsWith("/api/")) {
                        byte[] notFound = "{\\"error\\":\\"offline\\"}".getBytes(StandardCharsets.UTF_8);
                        return new WebResourceResponse("application/json", "UTF-8", 404, "Not Found", corsHeaders, new ByteArrayInputStream(notFound));
                    }

                    String cleanPath = path.split("[?#]", 2)[0];
                    if (cleanPath.equals("/")) cleanPath = "/index.html";
                    File otaRoot = activeOtaDir;
                    if (otaRoot != null) {
                        try {
                            String relPath = cleanPath.startsWith("/") ? cleanPath.substring(1) : cleanPath;
                            File otaFile = new File(otaRoot, relPath);
                            String rootCan = otaRoot.getCanonicalPath() + File.separator;
                            if (!otaFile.exists() || !otaFile.isFile() || !otaFile.getCanonicalPath().startsWith(rootCan)) {
                                otaFile = new File(otaRoot, "index.html");
                                relPath = "index.html";
                            }
                            if (otaFile.exists() && otaFile.isFile()) {
                                String mime = guessMime("public/" + relPath);
                                String enc = mime.startsWith("text/") || mime.contains("javascript") || mime.contains("json") || mime.contains("svg") ? "UTF-8" : null;
                                Map<String, String> otaHeaders = new HashMap<String, String>(corsHeaders);
                                if ("text/html".equals(mime)) {
                                    otaHeaders.put("Cache-Control", "no-store");
                                }
                                return new WebResourceResponse(mime, enc, 200, "OK", otaHeaders, new FileInputStream(otaFile));
                            }
                        } catch (Exception ignored) {
                        }
                    }
                    String assetPath = "public" + cleanPath;
                    try {
                        InputStream is = getAssets().open(assetPath);
                        String mime = guessMime(assetPath);
                        String enc = mime.startsWith("text/") || mime.contains("javascript") || mime.contains("json") || mime.contains("svg") ? "UTF-8" : null;
                        return new WebResourceResponse(mime, enc, 200, "OK", corsHeaders, is);
                    } catch (Exception e) {
                        try {
                            InputStream indexIs = getAssets().open("public/index.html");
                            return new WebResourceResponse("text/html", "UTF-8", 200, "OK", corsHeaders, indexIs);
                        } catch (Exception ignored) {
                            return null;
                        }
                    }
                }
                return super.shouldInterceptRequest(view, request);
            }
        });

        setContentView(webView);

        try {
            Intent serviceIntent = new Intent(this, PMusicPlaybackService.class);
            if (Build.VERSION.SDK_INT >= 26) {
                startForegroundService(serviceIntent);
            } else {
                startService(serviceIntent);
            }
        } catch (Exception ignored) {
        }

        handleDeepLinkIntent(getIntent(), true);
        try {
            carModeReceiver = new BroadcastReceiver() {
                @Override
                public void onReceive(Context context, Intent intent) {
                    if (intent == null) return;
                    String act = intent.getAction();
                    if (UiModeManager.ACTION_ENTER_CAR_MODE.equals(act)) {
                        dispatchCarModeToJs(true);
                    } else if (UiModeManager.ACTION_EXIT_CAR_MODE.equals(act)) {
                        dispatchCarModeToJs(false);
                    } else if (Intent.ACTION_DOCK_EVENT.equals(act)) {
                        int dockState = intent.getIntExtra(Intent.EXTRA_DOCK_STATE, Intent.EXTRA_DOCK_STATE_UNDOCKED);
                        dispatchCarModeToJs(dockState == Intent.EXTRA_DOCK_STATE_CAR || isCurrentlyInCarMode());
                    }
                }
            };
            IntentFilter carFilter = new IntentFilter();
            carFilter.addAction(UiModeManager.ACTION_ENTER_CAR_MODE);
            carFilter.addAction(UiModeManager.ACTION_EXIT_CAR_MODE);
            carFilter.addAction(Intent.ACTION_DOCK_EVENT);
            if (Build.VERSION.SDK_INT >= 33) {
                registerReceiver(carModeReceiver, carFilter, Context.RECEIVER_EXPORTED);
            } else {
                registerReceiver(carModeReceiver, carFilter);
            }
        } catch (Throwable ignored) {
        }
        refreshActiveOtaDir();
        startLocalStreamServer();
        webView.loadUrl("https://appassets.pmusic.local/index.html");
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_VOICE_SEARCH && resultCode == RESULT_OK && data != null) {
            try {
                ArrayList<String> matches = data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
                if (matches != null && !matches.isEmpty()) {
                    final String query = matches.get(0);
                    if (query != null && !query.trim().isEmpty() && webView != null && Build.VERSION.SDK_INT >= 19) {
                        final String js = "window.__pmusicVoiceSearchResult && window.__pmusicVoiceSearchResult(" + JSONObject.quote(query.trim()) + ");";
                        runOnUiThread(new Runnable() {
                            @Override
                            public void run() {
                                if (webView != null) webView.evaluateJavascript(js, null);
                            }
                        });
                    }
                }
            } catch (Exception ignored) {
            }
        }
    }

    public static void dispatchMediaAction(Context ctx, final String action, final double seekSec) {
        MainActivity inst = sInstance;
        if (inst == null || inst.webView == null) {
            sPendingMediaAction = action;
            sPendingMediaSeek = seekSec;
            return;
        }
        inst.dispatchMediaActionToJs(action, seekSec);
    }

    private void dispatchMediaActionToJs(final String action, final double seekSec) {
        if (webView == null || Build.VERSION.SDK_INT < 19 || action == null) return;
        final String js = "window.__pmusicNativeMediaAction && window.__pmusicNativeMediaAction(" + JSONObject.quote(action) + "," + seekSec + ");";
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (webView != null) webView.evaluateJavascript(js, null);
            }
        });
    }

    public static void dispatchCarPlayFromSearch(Context ctx, final String query) {
        MainActivity inst = sInstance;
        if (inst == null || inst.webView == null) {
            sPendingCarSearch = query;
            return;
        }
        inst.dispatchCarPlaySearchToJs(query);
    }

    private void dispatchCarPlaySearchToJs(final String query) {
        if (webView == null || Build.VERSION.SDK_INT < 19 || query == null) return;
        final String js = "window.__pmusicPlayFromSearch && window.__pmusicPlayFromSearch(" + JSONObject.quote(query) + ");";
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (webView != null) webView.evaluateJavascript(js, null);
            }
        });
    }

    public static void dispatchCarPlayFromMediaId(Context ctx, final String mediaId) {
        MainActivity inst = sInstance;
        if (inst == null || inst.webView == null) {
            sPendingCarMediaId = mediaId;
            return;
        }
        inst.dispatchCarPlayMediaIdToJs(mediaId);
    }

    private void dispatchCarPlayMediaIdToJs(final String mediaId) {
        if (webView == null || Build.VERSION.SDK_INT < 19 || mediaId == null) return;
        final String js = "window.__pmusicPlayFromMediaId && window.__pmusicPlayFromMediaId(" + JSONObject.quote(mediaId) + ");";
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (webView != null) webView.evaluateJavascript(js, null);
            }
        });
    }

    private BroadcastReceiver carModeReceiver;

    private boolean isCurrentlyInCarMode() {
        try {
            UiModeManager um = (UiModeManager) getSystemService(Context.UI_MODE_SERVICE);
            if (um != null && um.getCurrentModeType() == Configuration.UI_MODE_TYPE_CAR) {
                return true;
            }
            int uiMask = getResources().getConfiguration().uiMode & Configuration.UI_MODE_TYPE_MASK;
            return uiMask == Configuration.UI_MODE_TYPE_CAR;
        } catch (Throwable ignored) {
            return false;
        }
    }

    private void dispatchCarModeToJs(final boolean active) {
        if (webView == null || Build.VERSION.SDK_INT < 19) return;
        final String js = "window.__pmusicSetCarMode && window.__pmusicSetCarMode(" + (active ? "true" : "false") + ");";
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (webView != null) webView.evaluateJavascript(js, null);
            }
        });
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        if (newConfig != null) {
            boolean inCar = (newConfig.uiMode & Configuration.UI_MODE_TYPE_MASK) == Configuration.UI_MODE_TYPE_CAR;
            dispatchCarModeToJs(inCar || isCurrentlyInCarMode());
        }
    }

    private void dispatchAppBackgroundedToJs(final boolean bg) {
        if (webView == null || Build.VERSION.SDK_INT < 19) return;
        final String js = "window.__pmusicSetAppBackgrounded && window.__pmusicSetAppBackgrounded(" + (bg ? "true" : "false") + ");";
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (webView != null) webView.evaluateJavascript(js, null);
            }
        });
    }

    @Override
    protected void onPause() {
        super.onPause();
        dispatchAppBackgroundedToJs(true);
        if (webView != null && PMusicPlaybackService.isCurrentlyPlaying()) {
            try {
                webView.onResume();
                webView.resumeTimers();
            } catch (Throwable ignored) {
            }
        }
    }

    @Override
    protected void onStop() {
        super.onStop();
        dispatchAppBackgroundedToJs(true);
    }

    private void applySystemBarsAppearance(final boolean darkStatusIcons, final boolean darkNavIcons, final String statusBarHex, final String navBarHex) {
        final Window w = getWindow();
        if (w == null || Build.VERSION.SDK_INT < 21) return;
        final View decor = w.getDecorView();
        w.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS | WindowManager.LayoutParams.FLAG_TRANSLUCENT_NAVIGATION);
        w.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        if (Build.VERSION.SDK_INT >= 30) {
            try {
                w.setDecorFitsSystemWindows(false);
            } catch (Throwable ignored) {
            }
        }
        if (Build.VERSION.SDK_INT >= 29) {
            try {
                w.setStatusBarContrastEnforced(false);
                w.setNavigationBarContrastEnforced(false);
            } catch (Throwable ignored) {
            }
        }
        try {
            int sbColor = (statusBarHex == null || "transparent".equalsIgnoreCase(statusBarHex))
                    ? Color.TRANSPARENT
                    : Color.parseColor(statusBarHex);
            int nbColor = (navBarHex == null || "transparent".equalsIgnoreCase(navBarHex))
                    ? Color.TRANSPARENT
                    : Color.parseColor(navBarHex);
            w.setStatusBarColor(sbColor);
            w.setNavigationBarColor(nbColor);
        } catch (Throwable ignored) {
        }
        if (Build.VERSION.SDK_INT >= 30) {
            try {
                int mask = android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                        | android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                int val = (darkStatusIcons ? android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS : 0)
                        | (darkNavIcons ? android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS : 0);
                android.view.WindowInsetsController wCtrl = w.getInsetsController();
                if (wCtrl != null) {
                    wCtrl.setSystemBarsAppearance(val, mask);
                }
                android.view.WindowInsetsController dCtrl = decor != null ? decor.getWindowInsetsController() : null;
                if (dCtrl != null && dCtrl != wCtrl) {
                    dCtrl.setSystemBarsAppearance(val, mask);
                }
            } catch (Throwable ignored) {
            }
        }
        if (Build.VERSION.SDK_INT >= 23 && decor != null) {
            int flags = decor.getSystemUiVisibility()
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION;
            if (darkStatusIcons) {
                flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            } else {
                flags &= ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            }
            if (Build.VERSION.SDK_INT >= 26) {
                if (darkNavIcons) {
                    flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                } else {
                    flags &= ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                }
            }
            decor.setSystemUiVisibility(flags);
            if (!decor.isAttachedToWindow()) {
                decor.post(new Runnable() {
                    @Override
                    public void run() {
                        applySystemBarsAppearance(lastDarkStatusIcons, lastDarkNavIcons, lastStatusBarHex, lastNavBarHex);
                    }
                });
            }
        }
        try {
            Class<?> miuiLp = Class.forName("android.view.MiuiWindowManager$LayoutParams");
            int darkModeFlag = miuiLp.getField("EXTRA_FLAG_STATUS_BAR_DARK_MODE").getInt(miuiLp);
            java.lang.reflect.Method extraFlagMethod = w.getClass().getMethod("setExtraFlags", int.class, int.class);
            extraFlagMethod.invoke(w, darkStatusIcons ? darkModeFlag : 0, darkModeFlag);
        } catch (Throwable ignored) {
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        applySystemBarsAppearance(lastDarkStatusIcons, lastDarkNavIcons, lastStatusBarHex, lastNavBarHex);
        dispatchAppBackgroundedToJs(false);
        if (webView != null) {
            try {
                webView.onResume();
                webView.resumeTimers();
                if (Build.VERSION.SDK_INT >= 19) {
                    webView.evaluateJavascript("window.__pmusicOnAppResume && window.__pmusicOnAppResume();", null);
                }
            } catch (Throwable ignored) {
            }
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            applySystemBarsAppearance(lastDarkStatusIcons, lastDarkNavIcons, lastStatusBarHex, lastNavBarHex);
        }
    }

    @Override
    protected void onDestroy() {
        if (carModeReceiver != null) {
            try {
                unregisterReceiver(carModeReceiver);
            } catch (Exception ignored) {
            }
            carModeReceiver = null;
        }
        if (sInstance == this) {
            sInstance = null;
        }
        streamServerRunning = false;
        try {
            if (localStreamServer != null) localStreamServer.close();
        } catch (Exception ignored) {
        }
        streamExecutor.shutdownNow();
        super.onDestroy();
    }

    private void startLocalStreamServer() {
        if (streamServerRunning && localStreamPort > 0) return;
        try {
            localStreamServer = new ServerSocket(0, 32, InetAddress.getByName("127.0.0.1"));
            localStreamPort = localStreamServer.getLocalPort();
            streamServerRunning = true;
            Thread acceptor = new Thread(new Runnable() {
                @Override
                public void run() {
                    while (streamServerRunning && localStreamServer != null && !localStreamServer.isClosed()) {
                        try {
                            final Socket client = localStreamServer.accept();
                            streamExecutor.execute(new Runnable() {
                                @Override
                                public void run() {
                                    handleLoopbackClient(client);
                                }
                            });
                        } catch (Exception ignored) {
                            if (!streamServerRunning) break;
                        }
                    }
                }
            }, "PMusicLoopbackServer");
            acceptor.setDaemon(true);
            acceptor.start();
        } catch (Exception ignored) {
            localStreamPort = 0;
        }
    }

    private void handleLoopbackClient(Socket client) {
        HttpURLConnection conn = null;
        try {
            client.setSoTimeout(30000);
            BufferedReader reader = new BufferedReader(new InputStreamReader(client.getInputStream(), StandardCharsets.US_ASCII));
            String reqLine = reader.readLine();
            if (reqLine == null || reqLine.trim().isEmpty()) return;
            String[] tokens = reqLine.split(" ");
            String method = tokens.length >= 1 ? tokens[0].trim().toUpperCase(Locale.ROOT) : "GET";
            String target = tokens.length >= 2 ? tokens[1].trim() : "/";

            Map<String, String> reqHeaders = new HashMap<String, String>();
            String line;
            while ((line = reader.readLine()) != null && !line.isEmpty()) {
                int colon = line.indexOf(':');
                if (colon > 0) {
                    reqHeaders.put(line.substring(0, colon).trim().toLowerCase(Locale.ROOT), line.substring(colon + 1).trim());
                }
            }

            OutputStream out = client.getOutputStream();
            if ("OPTIONS".equals(method)) {
                String optResp = "HTTP/1.1 204 No Content\\r\\n"
                        + "Access-Control-Allow-Origin: *\\r\\n"
                        + "Access-Control-Allow-Methods: GET, HEAD, OPTIONS\\r\\n"
                        + "Access-Control-Allow-Headers: Range, Content-Type, Accept\\r\\n"
                        + "Access-Control-Expose-Headers: Content-Range, Content-Length, Accept-Ranges, X-PMusic-Stream-Quality, X-PMusic-Stream-Codec, X-PMusic-Stream-Bitrate\\r\\n"
                        + "Connection: close\\r\\n\\r\\n";
                out.write(optResp.getBytes(StandardCharsets.US_ASCII));
                out.flush();
                return;
            }

            Uri uri = Uri.parse("http://127.0.0.1" + target);
            String path = uri.getPath();
            if (path == null || !path.startsWith("/api/stream/")) {
                out.write("HTTP/1.1 404 Not Found\\r\\nAccess-Control-Allow-Origin: *\\r\\nContent-Length: 0\\r\\nConnection: close\\r\\n\\r\\n".getBytes(StandardCharsets.US_ASCII));
                out.flush();
                return;
            }

            String rawTrackId = Uri.decode(path.substring("/api/stream/".length()));
            String qTitle = uri.getQueryParameter("title");
            String qArtist = uri.getQueryParameter("artist");
            String qQuality = normalizeStreamQuality(uri.getQueryParameter("quality"));
            String qDurStr = uri.getQueryParameter("durationSec");
            int qDurSec = 0;
            if (qDurStr != null && !qDurStr.trim().isEmpty()) {
                try {
                    qDurSec = Math.round(Float.parseFloat(qDurStr.trim()));
                } catch (Exception ignored) {
                }
            }

            String cacheKey = (rawTrackId != null ? rawTrackId : "") + "::" + (qTitle != null ? qTitle.trim() : "") + "::" + qQuality;
            if ("1".equals(uri.getQueryParameter("fresh"))) {
                synchronized (fullStreamCache) {
                    fullStreamCache.remove(cacheKey);
                }
            }
            ResolvedStream fullStream = getOrResolveFullStream(cacheKey, rawTrackId, qTitle, qArtist, qDurSec, qQuality);
            if (fullStream == null) {
                out.write("HTTP/1.1 503 Service Unavailable\\r\\nAccess-Control-Allow-Origin: *\\r\\nContent-Type: application/json\\r\\nContent-Length: 30\\r\\nConnection: close\\r\\n\\r\\n{\\"error\\":\\"stream_unavailable\\"}".getBytes(StandardCharsets.UTF_8));
                out.flush();
                return;
            }

            try {
                client.setSendBufferSize(131072);
            } catch (Exception ignoredBuf) {
            }
            boolean isHead = "HEAD".equals(method);
            String clientRange = getHeaderIgnoreCase(reqHeaders, "range");
            boolean hasClientRange = clientRange != null && !clientRange.trim().isEmpty();
            boolean isLowQuality = "low".equals(qQuality);
            long chunkSpanBytes = isLowQuality ? 262143L : 1572863L;
            String rangeToSend = null;
            if (hasClientRange) {
                rangeToSend = clientRange.trim();
                Matcher om = OPEN_RANGE_PATTERN.matcher(rangeToSend);
                if (om.matches()) {
                    try {
                        long startByte = Long.parseLong(om.group(1));
                        long endByte = startByte + chunkSpanBytes;
                        rangeToSend = "bytes=" + startByte + "-" + endByte;
                    } catch (Exception ignored) {
                    }
                }
            }

            ResolvedStream active = fullStream;
            for (int attempt = 0; attempt < 2; attempt++) {
                conn = (HttpURLConnection) new URL(active.url).openConnection();
                conn.setRequestMethod(isHead ? "HEAD" : "GET");
                conn.setConnectTimeout(isLowQuality ? 18000 : 10000);
                conn.setReadTimeout(isLowQuality ? 45000 : 25000);
                conn.setInstanceFollowRedirects(true);
                conn.setRequestProperty("User-Agent", active.userAgent);
                if (rangeToSend != null) {
                    conn.setRequestProperty("Range", rangeToSend);
                }
                conn.setRequestProperty("Accept", "*/*");
                conn.setRequestProperty("Connection", "close");

                int code = conn.getResponseCode();
                if (code == 200 || code == 206) {
                    String upstreamLen = conn.getHeaderField("Content-Length");
                    String upstreamRange = conn.getHeaderField("Content-Range");
                    int outStatus = (!hasClientRange && code == 206) ? 200 : code;
                    String outReason = outStatus == 206 ? "Partial Content" : "OK";

                    StringBuilder sb = new StringBuilder();
                    sb.append("HTTP/1.1 ").append(outStatus).append(' ').append(outReason).append("\\r\\n");
                    sb.append("Access-Control-Allow-Origin: *\\r\\n");
                    sb.append("Access-Control-Allow-Methods: GET, HEAD, OPTIONS\\r\\n");
                    sb.append("Access-Control-Allow-Headers: Range, Content-Type, Accept\\r\\n");
                    sb.append("Access-Control-Expose-Headers: Content-Range, Content-Length, Accept-Ranges, X-PMusic-Stream-Quality, X-PMusic-Stream-Codec, X-PMusic-Stream-Bitrate\\r\\n");
                    sb.append("Accept-Ranges: bytes\\r\\n");
                    sb.append("Cache-Control: no-cache\\r\\n");
                    sb.append("X-PMusic-Stream-Quality: ").append(qQuality).append("\\r\\n");
                    if (!active.codec.isEmpty()) sb.append("X-PMusic-Stream-Codec: ").append(active.codec).append("\\r\\n");
                    if (active.bitrate > 0L) sb.append("X-PMusic-Stream-Bitrate: ").append(active.bitrate).append("\\r\\n");
                    sb.append("Content-Type: ").append(active.mime).append("\\r\\n");
                    if (upstreamLen != null) sb.append("Content-Length: ").append(upstreamLen).append("\\r\\n");
                    if (outStatus == 206 && upstreamRange != null) {
                        sb.append("Content-Range: ").append(upstreamRange).append("\\r\\n");
                    }
                    sb.append("Connection: close\\r\\n\\r\\n");
                    out.write(sb.toString().getBytes(StandardCharsets.US_ASCII));

                    if (!isHead) {
                        InputStream in = conn.getInputStream();
                        byte[] buf = new byte[65536];
                        int r;
                        while ((r = in.read(buf)) != -1) {
                            out.write(buf, 0, r);
                        }
                        in.close();
                    }
                    out.flush();
                    conn.disconnect();
                    conn = null;
                    return;
                }
                conn.disconnect();
                conn = null;
                if ((code == 403 || code == 410) && attempt == 0) {
                    synchronized (fullStreamCache) {
                        fullStreamCache.remove(cacheKey);
                    }
                    ResolvedStream refreshed = getOrResolveFullStream(cacheKey, rawTrackId, qTitle, qArtist, qDurSec, qQuality);
                    if (refreshed == null) break;
                    active = refreshed;
                } else {
                    break;
                }
            }
            out.write("HTTP/1.1 502 Bad Gateway\\r\\nAccess-Control-Allow-Origin: *\\r\\nContent-Length: 0\\r\\nConnection: close\\r\\n\\r\\n".getBytes(StandardCharsets.US_ASCII));
            out.flush();
        } catch (Exception ignored) {
        } finally {
            if (conn != null) {
                try {
                    conn.disconnect();
                } catch (Exception ignored2) {
                }
            }
            try {
                client.close();
            } catch (Exception ignored3) {
            }
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleDeepLinkIntent(intent, false);
    }

    private void handleDeepLinkIntent(Intent intent, boolean isInitialCreate) {
        if (intent == null) return;
        String relTrackId = intent.getStringExtra("pmusic_release_track_id");
        String relAlbumId = intent.getStringExtra("pmusic_release_album_id");
        String relTitle = intent.getStringExtra("pmusic_release_title");
        String relArtist = intent.getStringExtra("pmusic_release_artist");
        String relCover = intent.getStringExtra("pmusic_release_cover");
        if ((relTrackId != null && !relTrackId.isEmpty())
                || (relAlbumId != null && !relAlbumId.isEmpty())
                || (relTitle != null && !relTitle.isEmpty())) {
            intent.removeExtra("pmusic_release_track_id");
            intent.removeExtra("pmusic_release_album_id");
            intent.removeExtra("pmusic_release_title");
            intent.removeExtra("pmusic_release_artist");
            intent.removeExtra("pmusic_release_cover");
            try {
                org.json.JSONObject relObj = new org.json.JSONObject();
                relObj.put("trackId", relTrackId != null ? relTrackId : "");
                relObj.put("albumId", relAlbumId != null ? relAlbumId : "");
                relObj.put("title", relTitle != null ? relTitle : "");
                relObj.put("artist", relArtist != null ? relArtist : "");
                relObj.put("coverUrl", relCover != null ? relCover : "");
                String payload = relObj.toString();
                if (isInitialCreate) {
                    sPendingReleaseJson = payload;
                } else {
                    dispatchReleaseTrackToJs(payload);
                }
            } catch (Throwable ignored) {
            }
        }
        String widgetOpenKind = intent.getStringExtra("pmusic_widget_open_kind");
        String widgetOpenId = intent.getStringExtra("pmusic_widget_open_id");
        if (widgetOpenId != null && !widgetOpenId.isEmpty()) {
            intent.removeExtra("pmusic_widget_open_kind");
            intent.removeExtra("pmusic_widget_open_id");
            try {
                org.json.JSONObject wo = new org.json.JSONObject();
                wo.put("kind", widgetOpenKind != null ? widgetOpenKind : "track");
                wo.put("id", widgetOpenId);
                String payload = wo.toString();
                if (isInitialCreate) {
                    sPendingWidgetOpenJson = payload;
                } else {
                    dispatchWidgetOpenToJs(payload);
                }
            } catch (Throwable ignored) {
            }
        }
        String widgetAct = intent.getStringExtra("pmusic_widget_action");
        if (widgetAct != null && !widgetAct.isEmpty()) {
            intent.removeExtra("pmusic_widget_action");
            if (isInitialCreate) {
                sPendingMediaAction = widgetAct;
                sPendingMediaSeek = -1;
            } else {
                dispatchMediaAction(this, widgetAct, -1);
            }
        }
        Uri data = intent.getData();
        if (data != null && "pmusic".equalsIgnoreCase(data.getScheme())) {
            String fullUrl = data.toString();
            pendingAuthCallbackUrl = fullUrl;
            dispatchAuthCallbackToJs(fullUrl);
        }
    }

    private void dispatchWidgetOpenToJs(final String payloadJson) {
        if (webView == null || payloadJson == null || Build.VERSION.SDK_INT < 19) return;
        final String js = "try{window.dispatchEvent(new CustomEvent('pmusic:widget-open-item',{detail:JSON.parse("
                + org.json.JSONObject.quote(payloadJson) + ")}));}catch(e){}";
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (webView != null) {
                    webView.evaluateJavascript(js, null);
                }
            }
        });
    }

    private void dispatchReleaseTrackToJs(final String payloadJson) {
        if (webView == null || payloadJson == null || Build.VERSION.SDK_INT < 19) return;
        final String js = "(function(){if(typeof window.__pmusicOpenReleaseTrack==='function'){window.__pmusicOpenReleaseTrack("
                + org.json.JSONObject.quote(payloadJson) + ");}})();";
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (webView != null) {
                    webView.evaluateJavascript(js, null);
                }
            }
        });
    }

    private void dispatchAuthCallbackToJs(final String callbackUrl) {
        if (webView == null || callbackUrl == null || Build.VERSION.SDK_INT < 19) return;
        final String escaped = callbackUrl.replace("\\\\", "\\\\\\\\").replace("'", "\\\\'");
        webView.post(new Runnable() {
            @Override
            public void run() {
                if (webView == null) return;
                String js = "(function(){if(typeof window.__pmusicHandleAuthCallback==='function'){window.__pmusicHandleAuthCallback('"
                        + escaped + "');}})();";
                webView.evaluateJavascript(js, null);
            }
        });
    }

    private void injectSafeAreaInsets() {
        if (webView == null || Build.VERSION.SDK_INT < 19) return;
        final int top = safeInsetTopDp;
        final int bottom = safeInsetBottomDp;
        webView.post(new Runnable() {
            @Override
            public void run() {
                if (webView == null) return;
                String js = "(function(){var r=document.documentElement;if(!r)return;"
                        + "r.style.setProperty('--pm-safe-top','" + top + "px');"
                        + "r.style.setProperty('--pm-safe-bottom','" + bottom + "px');})();";
                webView.evaluateJavascript(js, null);
            }
        });
    }

    private Object lockForKey(String key) {
        synchronized (keyLocks) {
            Object lock = keyLocks.get(key);
            if (lock == null) {
                lock = new Object();
                if (keyLocks.size() > 128) keyLocks.clear();
                keyLocks.put(key, lock);
            }
            return lock;
        }
    }

    private ResolvedStream getOrResolveFullStream(String cacheKey, String rawTrackId, String qTitle, String qArtist, int qDurationSec, String qQuality) {
        long now = System.currentTimeMillis();
        synchronized (fullStreamCache) {
            ResolvedStream cached = fullStreamCache.get(cacheKey);
            if (cached != null && cached.expiresAtMs > now + 60000L) {
                return cached;
            }
        }
        synchronized (lockForKey(cacheKey)) {
            long now2 = System.currentTimeMillis();
            synchronized (fullStreamCache) {
                ResolvedStream cached = fullStreamCache.get(cacheKey);
                if (cached != null && cached.expiresAtMs > now2 + 60000L) {
                    return cached;
                }
            }
            ResolvedStream resolved = resolveFullLengthStream(rawTrackId, qTitle, qArtist, qDurationSec, qQuality);
            if (resolved != null) {
                synchronized (fullStreamCache) {
                    fullStreamCache.put(cacheKey, resolved);
                }
            }
            return resolved;
        }
    }

    private ResolvedStream resolveFullLengthStream(String rawTrackId, String qTitle, String qArtist, int qDurationSec, String qQuality) {
        try {
            boolean ytAllowed = System.currentTimeMillis() >= ytBotCooldownUntilMs;
            if (ytAllowed && rawTrackId != null && YT_ID_PATTERN.matcher(rawTrackId).matches()) {
                ResolvedStream direct = fetchYoutubeIosPlayerStream(rawTrackId, qDurationSec, qQuality);
                if (direct != null) return direct;
            }

            String title = qTitle != null ? qTitle.trim() : "";
            String artist = qArtist != null ? qArtist.trim() : "";
            int targetDur = qDurationSec;

            if (title.isEmpty() && rawTrackId != null && rawTrackId.startsWith("dz:")) {
                String dzId = rawTrackId.substring(3);
                byte[] metaBytes = fetchRemoteBytes("https://api.deezer.com/track/" + dzId);
                if (metaBytes != null) {
                    JSONObject obj = new JSONObject(new String(metaBytes, StandardCharsets.UTF_8));
                    title = obj.optString("title", "").trim();
                    if (targetDur <= 0) targetDur = obj.optInt("duration", 0);
                    JSONObject artObj = obj.optJSONObject("artist");
                    if (artObj != null && artist.isEmpty()) {
                        artist = artObj.optString("name", "").trim();
                    }
                }
            }
            if (title.isEmpty()) return null;
            if (targetDur <= 0) targetDur = 200;

            String strippedTitle = TITLE_NOISE_PATTERN.matcher(title).replaceAll(" ").replaceAll("\\\\s+", " ").trim();
            if (strippedTitle.isEmpty()) strippedTitle = title;
            String primaryArtist = artist.split("(?i),|&|\\\\bfeat\\\\.?\\\\b|\\\\bft\\\\.?\\\\b")[0].trim();
            String focusedQuery = (primaryArtist.isEmpty() ? strippedTitle : primaryArtist + " " + strippedTitle).trim();

            if (System.currentTimeMillis() >= ytBotCooldownUntilMs) {
                // 1) Primary: YouTube Music Songs search (WEB_REMIX)
                List<Candidate> ytmCandidates = searchYtMusicSongs(focusedQuery, strippedTitle, primaryArtist, targetDur);
                for (int i = 0; i < Math.min(3, ytmCandidates.size()); i++) {
                    if (System.currentTimeMillis() < ytBotCooldownUntilMs) break;
                    ResolvedStream rs = fetchYoutubeIosPlayerStream(ytmCandidates.get(i).videoId, targetDur, qQuality);
                    if (rs != null) return rs;
                }

                // 2) Fallback: Standard YouTube search (WEB) matching Desktop strategies
                String[] ytQueries = primaryArtist.isEmpty()
                        ? new String[] { strippedTitle + " audio", strippedTitle }
                        : new String[] {
                            primaryArtist + " - " + strippedTitle + " audio",
                            primaryArtist + " " + strippedTitle + " topic",
                            focusedQuery + " audio",
                            focusedQuery
                        };
                for (int q = 0; q < ytQueries.length; q++) {
                    if (System.currentTimeMillis() < ytBotCooldownUntilMs) break;
                    List<Candidate> ytCandidates = searchStandardYoutube(ytQueries[q], strippedTitle, primaryArtist, targetDur);
                    for (int i = 0; i < Math.min(3, ytCandidates.size()); i++) {
                        if (System.currentTimeMillis() < ytBotCooldownUntilMs) break;
                        ResolvedStream rs = fetchYoutubeIosPlayerStream(ytCandidates.get(i).videoId, targetDur, qQuality);
                        if (rs != null) return rs;
                    }
                }
            }

            // 3) Fast fallback: Audius Public API (full MP3/MPEG stream, zero anti-bot)
            ResolvedStream audius = resolveAudiusFullStream(strippedTitle, primaryArtist, targetDur);
            if (audius != null) return audius;
        } catch (Exception ignored) {
        }
        return null;
    }

    private ResolvedStream resolveAudiusFullStream(String targetTitle, String targetArtist, int targetDurSec) {
        try {
            String primary = targetArtist != null ? targetArtist.trim() : "";
            String focused = (primary.isEmpty() ? targetTitle : primary + " " + targetTitle).trim();
            String[] queries = primary.isEmpty() ? new String[] { targetTitle } : new String[] { focused, targetTitle };

            String bestId = null;
            int bestScore = Integer.MIN_VALUE;

            for (int qIdx = 0; qIdx < queries.length; qIdx++) {
                String q = queries[qIdx];
                if (q == null || q.isEmpty()) continue;
                byte[] bytes = fetchRemoteBytes("https://api.audius.co/v1/tracks/search?query=" + URLEncoder.encode(q, "UTF-8") + "&app_name=pMusic");
                if (bytes == null) continue;
                JSONObject root = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
                JSONArray arr = root.optJSONArray("data");
                if (arr == null) continue;

                for (int i = 0; i < Math.min(12, arr.length()); i++) {
                    JSONObject item = arr.optJSONObject(i);
                    if (item == null) continue;
                    String id = item.optString("id", "").trim();
                    if (id.isEmpty() || !item.optBoolean("is_streamable", true)) continue;
                    int dur = item.optInt("duration", 0);
                    if (dur < 40) continue;
                    String candTitle = item.optString("title", "");
                    JSONObject userObj = item.optJSONObject("user");
                    String candArtist = userObj != null ? userObj.optString("name", "") : "";
                    String candHandle = userObj != null ? userObj.optString("handle", "") : "";
                    if (hasDisallowedVersion(targetTitle, candTitle + " " + candArtist)) {
                        continue;
                    }
                    if (!primary.isEmpty()) {
                        String normUploader = normText(candArtist + " " + candHandle);
                        String normPrimary = normText(primary);
                        boolean uploaderOk = !normPrimary.isEmpty() && normUploader.contains(normPrimary);
                        if (!uploaderOk) {
                            List<String> pToks = tokenizeNorm(primary);
                            for (int k = 0; k < pToks.size(); k++) {
                                String pt = pToks.get(k);
                                if (pt.length() >= 3 && normUploader.contains(pt)) {
                                    uploaderOk = true;
                                    break;
                                }
                            }
                        }
                        if (!uploaderOk) continue;
                    }
                    int sc = scoreAudioCandidate(targetTitle, primary, targetDurSec, candTitle, candArtist, dur, true);
                    if (sc >= 8 && sc > bestScore) {
                        bestScore = sc;
                        bestId = id;
                    }
                }
                if (bestId != null) break;
            }
            if (bestId != null) {
                return new ResolvedStream(
                        "https://api.audius.co/v1/tracks/" + URLEncoder.encode(bestId, "UTF-8") + "/stream?app_name=pMusic",
                        "audio/mpeg",
                        "pMusic-Android/0.13.0",
                        System.currentTimeMillis() + STREAM_CACHE_TTL_MS,
                        "mp3",
                        320000L,
                        false
                );
            }
        } catch (Exception ignored) {
        }
        return null;
    }

    private List<Candidate> searchYtMusicSongs(String query, String targetTitle, String targetArtist, int targetDurSec) {
        List<Candidate> results = new ArrayList<Candidate>();
        List<Candidate> relaxed = new ArrayList<Candidate>();
        try {
            JSONObject client = new JSONObject();
            client.put("clientName", "WEB_REMIX");
            client.put("clientVersion", "1.20250310.01.00");
            client.put("hl", "es");
            client.put("gl", "ES");
            JSONObject context = new JSONObject();
            context.put("client", client);
            JSONObject payload = new JSONObject();
            payload.put("context", context);
            payload.put("query", query);
            payload.put("params", "EgWKAQIIAWoMEAMQBBAJEAoQBRAV");

            byte[] resp = postJsonBytes("https://music.youtube.com/youtubei/v1/search?prettyPrint=false", YT_WEB_UA, "https://music.youtube.com", payload.toString());
            if (resp == null) return results;
            JSONObject root = new JSONObject(new String(resp, StandardCharsets.UTF_8));
            List<JSONObject> renderers = new ArrayList<JSONObject>();
            collectObjectsByKey(root, "musicResponsiveListItemRenderer", renderers);

            for (int i = 0; i < renderers.size(); i++) {
                JSONObject r = renderers.get(i);
                String vid = findFirstStringByKey(r, "videoId");
                if (vid == null || !YT_ID_PATTERN.matcher(vid).matches()) continue;
                JSONArray flex = r.optJSONArray("flexColumns");
                if (flex == null || flex.length() == 0) continue;

                String candTitle = extractFlexColumnText(flex.optJSONObject(0));
                int durSec = 0;
                StringBuilder subText = new StringBuilder();
                for (int c = 1; c < flex.length(); c++) {
                    String colText = extractFlexColumnText(flex.optJSONObject(c));
                    if (colText == null || colText.isEmpty()) continue;
                    String[] segs = colText.split("\\\\s*[\\\\u2022\\\\u00b7|]\\\\s*");
                    for (int s = 0; s < segs.length; s++) {
                        String part = segs[s].trim();
                        int parsed = parseDurationSec(part);
                        if (parsed > 0 && durSec == 0) {
                            durSec = parsed;
                        } else if (!part.isEmpty()) {
                            if (subText.length() > 0) subText.append(" ");
                            subText.append(part);
                        }
                    }
                }
                if (durSec == 0) {
                    JSONArray fixed = r.optJSONArray("fixedColumns");
                    if (fixed != null) {
                        for (int k = 0; k < fixed.length(); k++) {
                            int parsedFixed = parseDurationSec(extractFlexColumnText(fixed.optJSONObject(k)));
                            if (parsedFixed > 0) {
                                durSec = parsedFixed;
                                break;
                            }
                        }
                    }
                }
                if (durSec < 40) continue;
                int score = scoreAudioCandidate(targetTitle, targetArtist, targetDurSec, candTitle, subText.toString(), durSec, true);
                if (score >= 6) {
                    results.add(new Candidate(vid, score));
                } else if (score >= 1 && durSec >= 45) {
                    relaxed.add(new Candidate(vid, score));
                }
            }
            if (results.isEmpty() && !relaxed.isEmpty()) {
                results.addAll(relaxed);
            }
            Collections.sort(results, new Comparator<Candidate>() {
                @Override
                public int compare(Candidate a, Candidate b) {
                    return Integer.compare(b.score, a.score);
                }
            });
        } catch (Exception ignored) {
        }
        return results;
    }

    private List<Candidate> searchStandardYoutube(String query, String targetTitle, String targetArtist, int targetDurSec) {
        List<Candidate> results = new ArrayList<Candidate>();
        List<Candidate> relaxed = new ArrayList<Candidate>();
        try {
            JSONObject client = new JSONObject();
            client.put("clientName", "WEB");
            client.put("clientVersion", "2.20250310.01.00");
            client.put("hl", "es");
            client.put("gl", "ES");
            JSONObject context = new JSONObject();
            context.put("client", client);
            JSONObject payload = new JSONObject();
            payload.put("context", context);
            payload.put("query", query);

            byte[] resp = postJsonBytes("https://www.youtube.com/youtubei/v1/search?prettyPrint=false", YT_WEB_UA, "https://www.youtube.com", payload.toString());
            if (resp == null) return results;
            JSONObject root = new JSONObject(new String(resp, StandardCharsets.UTF_8));
            List<JSONObject> renderers = new ArrayList<JSONObject>();
            collectObjectsByKey(root, "videoRenderer", renderers);

            for (int i = 0; i < renderers.size(); i++) {
                JSONObject r = renderers.get(i);
                String vid = r.optString("videoId", "").trim();
                if (!YT_ID_PATTERN.matcher(vid).matches()) continue;
                String candTitle = extractRunsText(r.optJSONObject("title"));
                String candAuthor = extractRunsText(r.optJSONObject("ownerText"));
                if (candAuthor.isEmpty()) candAuthor = extractRunsText(r.optJSONObject("longBylineText"));
                String lenText = extractRunsText(r.optJSONObject("lengthText"));
                int durSec = parseDurationSec(lenText);
                if (durSec < 40) continue;
                int score = scoreAudioCandidate(targetTitle, targetArtist, targetDurSec, candTitle, candAuthor, durSec, false);
                if (score >= 6) {
                    results.add(new Candidate(vid, score));
                } else if (score >= 1 && durSec >= 45) {
                    relaxed.add(new Candidate(vid, score));
                }
            }
            if (results.isEmpty() && !relaxed.isEmpty()) {
                results.addAll(relaxed);
            }
            Collections.sort(results, new Comparator<Candidate>() {
                @Override
                public int compare(Candidate a, Candidate b) {
                    return Integer.compare(b.score, a.score);
                }
            });
        } catch (Exception ignored) {
        }
        return results;
    }

    private boolean isAdaptiveFullStreamableUrl(String streamUrl, String userAgent, long contentLength) {
        if (!isStreamableUrlRange(streamUrl, userAgent, "bytes=0-65535")) {
            return false;
        }
        // YouTube often gates adaptive audio streams after ~1 MB while still returning 206 for the first 64 KB.
        // Probe the tail (or open range) so gated 403 streams fail fast and fall back to a reliable stream.
        if (contentLength > 65536L) {
            long tailStart = Math.max(0L, contentLength - 65536L);
            long tailEnd = contentLength - 1L;
            return isStreamableUrlRange(streamUrl, userAgent, "bytes=" + tailStart + "-" + tailEnd);
        }
        return isStreamableUrlRange(streamUrl, userAgent, "bytes=0-");
    }

    private boolean isStreamableUrl(String streamUrl, String userAgent) {
        return isStreamableUrlRange(streamUrl, userAgent, "bytes=0-65535");
    }

    private boolean isStreamableUrlRange(String streamUrl, String userAgent, String rangeHeader) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(streamUrl).openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(3500);
            conn.setReadTimeout(3500);
            conn.setInstanceFollowRedirects(true);
            conn.setRequestProperty("User-Agent", userAgent);
            conn.setRequestProperty("Range", rangeHeader);
            conn.setRequestProperty("Accept", "*/*");
            conn.setRequestProperty("Connection", "close");
            int code = conn.getResponseCode();
            String ctype = conn.getContentType();
            boolean html = ctype != null && ctype.toLowerCase(Locale.ROOT).startsWith("text/html");
            return (code == 200 || code == 206) && !html;
        } catch (Exception ignored) {
            return false;
        } finally {
            if (conn != null) {
                try {
                    conn.disconnect();
                } catch (Exception ignored2) {
                }
            }
        }
    }

    private ResolvedStream fetchYoutubeIosPlayerStream(String videoId, int expectedDurSec, String qQuality) {
        int[] botRejects = new int[] { 0 };
        String[] modes = new String[] { "IOS", "ANDROID_VR", "ANDROID", "ANDROID_21", "MWEB" };
        for (int i = 0; i < modes.length; i++) {
            ResolvedStream stream = fetchYoutubeClientPlayerStream(videoId, expectedDurSec, modes[i], qQuality, botRejects);
            if (stream != null) {
                ytBotCooldownUntilMs = 0L;
                return stream;
            }
        }
        if (botRejects[0] >= modes.length) {
            ytBotCooldownUntilMs = System.currentTimeMillis() + 30000L;
        }
        return null;
    }

    private static boolean formatMatchesExpectedDuration(JSONObject f, int expectedDurSec) {
        if (expectedDurSec < 45) return true;
        long approxMs = f.optLong("approxDurationMs", 0L);
        if (approxMs <= 10000L) return true;
        double approxSec = approxMs / 1000.0;
        return Math.abs(approxSec - expectedDurSec) <= Math.max(35.0, expectedDurSec * 0.4);
    }

    private static long effectiveFormatBitrate(JSONObject f) {
        long avg = f.optLong("averageBitrate", 0L);
        return avg > 0L ? avg : f.optLong("bitrate", 0L);
    }

    private static boolean isOpusJsonFormat(JSONObject f) {
        int itag = f.optInt("itag", 0);
        String mime = f.optString("mimeType", "").toLowerCase(Locale.ROOT);
        return mime.contains("opus") || mime.contains("webm") || itag == 251 || itag == 250 || itag == 249 || itag == 774 || itag == 600;
    }

    private static boolean isAacJsonFormat(JSONObject f) {
        int itag = f.optInt("itag", 0);
        String mime = f.optString("mimeType", "").toLowerCase(Locale.ROOT);
        return mime.contains("mp4") || mime.contains("mp4a") || itag == 140 || itag == 141 || itag == 139 || itag == 599;
    }

    private static String extractJsonCodecLabel(String mimeRaw) {
        String lower = mimeRaw != null ? mimeRaw.toLowerCase(Locale.ROOT) : "";
        if (lower.contains("opus") || lower.contains("webm")) return "opus";
        if (lower.contains("mp4a.40.2")) return "aac-lc";
        if (lower.contains("mp4a.40.5")) return "he-aac";
        if (lower.contains("mp4")) return "aac";
        return "audio";
    }

    private ResolvedStream fetchYoutubeClientPlayerStream(String videoId, int expectedDurSec, String clientMode, String qQuality, int[] botRejects) {
        try {
            JSONObject client = new JSONObject();
            JSONObject thirdParty = null;
            String ua;
            if ("ANDROID".equals(clientMode)) {
                client.put("clientName", "ANDROID");
                client.put("clientVersion", "20.10.38");
                client.put("androidSdkVersion", 34);
                ua = "com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip";
            } else if ("ANDROID_21".equals(clientMode)) {
                client.put("clientName", "ANDROID");
                client.put("clientVersion", "21.02.34");
                client.put("osName", "Android");
                client.put("osVersion", "15");
                client.put("androidSdkVersion", 35);
                ua = "com.google.android.youtube/21.02.34 (Linux; U; Android 15) gzip";
            } else if ("ANDROID_VR".equals(clientMode)) {
                client.put("clientName", "ANDROID_VR");
                client.put("clientVersion", "1.60.19");
                client.put("deviceMake", "Oculus");
                client.put("deviceModel", "Quest 3");
                client.put("osName", "Android");
                client.put("osVersion", "12L");
                client.put("androidSdkVersion", 32);
                ua = "com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip";
            } else if ("IOS".equals(clientMode)) {
                client.put("clientName", "IOS");
                client.put("clientVersion", "20.10.4");
                client.put("deviceMake", "Apple");
                client.put("deviceModel", "iPhone16,2");
                client.put("osName", "iPhone");
                client.put("osVersion", "18.3.2.22D82");
                ua = YT_IOS_UA;
            } else {
                client.put("clientName", "MWEB");
                client.put("clientVersion", "2.20250310.01.00");
                ua = YT_WEB_UA;
            }
            client.put("hl", "es");
            client.put("gl", "ES");
            JSONObject context = new JSONObject();
            context.put("client", client);
            if (thirdParty != null) {
                context.put("thirdParty", thirdParty);
            }
            JSONObject payload = new JSONObject();
            payload.put("videoId", videoId);
            payload.put("context", context);

            byte[] resp = postJsonBytes("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", ua, "https://www.youtube.com", payload.toString());
            if (resp == null) return null;
            JSONObject root = new JSONObject(new String(resp, StandardCharsets.UTF_8));
            JSONObject statusObj = root.optJSONObject("playabilityStatus");
            String statusStr = statusObj != null ? statusObj.optString("status", "") : "";
            if ("LOGIN_REQUIRED".equalsIgnoreCase(statusStr)) {
                String reason = statusObj.optString("reason", "").toLowerCase(Locale.ROOT);
                if (reason.contains("bot") || reason.contains("inicia") || reason.contains("sign in")) {
                    if (botRejects != null && botRejects.length > 0) botRejects[0]++;
                }
                return null;
            }
            if (statusObj == null || !"OK".equalsIgnoreCase(statusStr)) {
                return null;
            }
            JSONObject streamingData = root.optJSONObject("streamingData");
            if (streamingData == null) return null;

            final List<JSONObject> sortedProg = new ArrayList<JSONObject>();
            JSONArray progressive = streamingData.optJSONArray("formats");
            if (progressive != null) {
                for (int i = 0; i < progressive.length(); i++) {
                    JSONObject f = progressive.optJSONObject(i);
                    if (f == null) continue;
                    String url = f.optString("url", "");
                    if (!url.startsWith("http") || !formatMatchesExpectedDuration(f, expectedDurSec)) continue;
                    sortedProg.add(f);
                }
                Collections.sort(sortedProg, new Comparator<JSONObject>() {
                    @Override
                    public int compare(JSONObject a, JSONObject b) {
                        boolean aPref = a.optInt("itag", 0) == 18 || a.optString("mimeType", "").toLowerCase(Locale.ROOT).contains("mp4");
                        boolean bPref = b.optInt("itag", 0) == 18 || b.optString("mimeType", "").toLowerCase(Locale.ROOT).contains("mp4");
                        if (aPref != bPref) return bPref ? 1 : -1;
                        return Long.compare(effectiveFormatBitrate(b), effectiveFormatBitrate(a));
                    }
                });
            }

            final List<JSONObject> sortedAdap = new ArrayList<JSONObject>();
            JSONArray adaptive = streamingData.optJSONArray("adaptiveFormats");
            if (adaptive != null) {
                for (int i = 0; i < adaptive.length(); i++) {
                    JSONObject f = adaptive.optJSONObject(i);
                    if (f == null) continue;
                    String url = f.optString("url", "");
                    String mimeRaw = f.optString("mimeType", "").toLowerCase(Locale.ROOT);
                    if (!url.startsWith("http") || !mimeRaw.startsWith("audio/") || !formatMatchesExpectedDuration(f, expectedDurSec)) continue;
                    sortedAdap.add(f);
                }
                final String qual = normalizeStreamQuality(qQuality);
                Collections.sort(sortedAdap, new Comparator<JSONObject>() {
                    @Override
                    public int compare(JSONObject a, JSONObject b) {
                        long aBps = effectiveFormatBitrate(a);
                        long bBps = effectiveFormatBitrate(b);
                        if ("low".equals(qual)) {
                            int aTier = (aBps >= 24000L && aBps <= 56000L) ? 3
                                    : (aBps > 56000L && aBps <= 85000L ? 2 : (aBps > 0L && aBps < 24000L ? 1 : 0));
                            int bTier = (bBps >= 24000L && bBps <= 56000L) ? 3
                                    : (bBps > 56000L && bBps <= 85000L ? 2 : (bBps > 0L && bBps < 24000L ? 1 : 0));
                            if (aTier != bTier) return Integer.compare(bTier, aTier);
                            if (aBps != bBps) return Long.compare(aBps, bBps);
                            return Integer.compare(isOpusJsonFormat(b) ? 1 : 0, isOpusJsonFormat(a) ? 1 : 0);
                        }
                        if ("medium".equals(qual) || "auto".equals(qual)) {
                            int aTier = (isAacJsonFormat(a) && aBps >= 96000L && aBps <= 165000L) ? 3
                                    : (isOpusJsonFormat(a) && aBps >= 64000L && aBps <= 170000L ? 2 : (aBps >= 55000L ? 1 : 0));
                            int bTier = (isAacJsonFormat(b) && bBps >= 96000L && bBps <= 165000L) ? 3
                                    : (isOpusJsonFormat(b) && bBps >= 64000L && bBps <= 170000L ? 2 : (bBps >= 55000L ? 1 : 0));
                            if (aTier != bTier) return Integer.compare(bTier, aTier);
                            return "auto".equals(qual) ? Long.compare(aBps, bBps) : Long.compare(bBps, aBps);
                        }
                        // high: Opus >= 110k (48 kHz) first, then AAC >= 110k, then highest adaptive bitrate
                        int aTier = (isOpusJsonFormat(a) && aBps >= 110000L) ? 4
                                : (isAacJsonFormat(a) && aBps >= 110000L ? 3 : (aBps >= 85000L ? 2 : 1));
                        int bTier = (isOpusJsonFormat(b) && bBps >= 110000L) ? 4
                                : (isAacJsonFormat(b) && bBps >= 110000L ? 3 : (bBps >= 85000L ? 2 : 1));
                        if (aTier != bTier) return Integer.compare(bTier, aTier);
                        long aSr = a.optLong("audioSampleRate", 0L);
                        long bSr = b.optLong("audioSampleRate", 0L);
                        if (aSr != bSr) return Long.compare(bSr, aSr);
                        return Long.compare(bBps, aBps);
                    }
                });
            }

            final String normalizedQ = normalizeStreamQuality(qQuality);
            final List<JSONObject> orderedJson = new ArrayList<JSONObject>();
            final List<Boolean> orderedIsAdap = new ArrayList<Boolean>();
            if ("medium".equals(normalizedQ) || "auto".equals(normalizedQ)) {
                List<JSONObject> medTail = new ArrayList<JSONObject>();
                for (int i = 0; i < sortedAdap.size(); i++) {
                    JSONObject f = sortedAdap.get(i);
                    if (effectiveFormatBitrate(f) >= 55000L) {
                        orderedJson.add(f);
                        orderedIsAdap.add(Boolean.TRUE);
                    } else {
                        medTail.add(f);
                    }
                }
                for (int i = 0; i < sortedProg.size(); i++) {
                    orderedJson.add(sortedProg.get(i));
                    orderedIsAdap.add(Boolean.FALSE);
                }
                for (int i = 0; i < medTail.size(); i++) {
                    orderedJson.add(medTail.get(i));
                    orderedIsAdap.add(Boolean.TRUE);
                }
            } else {
                for (int i = 0; i < sortedAdap.size(); i++) {
                    orderedJson.add(sortedAdap.get(i));
                    orderedIsAdap.add(Boolean.TRUE);
                }
                for (int i = 0; i < sortedProg.size(); i++) {
                    orderedJson.add(sortedProg.get(i));
                    orderedIsAdap.add(Boolean.FALSE);
                }
            }

            for (int i = 0; i < orderedJson.size(); i++) {
                JSONObject f = orderedJson.get(i);
                boolean isAdap = orderedIsAdap.get(i).booleanValue();
                String candUrl = f.optString("url", "");
                long clen = 0L;
                try {
                    String clStr = f.optString("contentLength", "0");
                    if (clStr != null && !clStr.isEmpty()) clen = Long.parseLong(clStr);
                } catch (Exception ignored2) {
                }
                boolean ok = isAdap
                        ? isAdaptiveFullStreamableUrl(candUrl, ua, clen)
                        : isStreamableUrl(candUrl, ua);
                if (ok) {
                    String mimeRaw = f.optString("mimeType", "").toLowerCase(Locale.ROOT);
                    String mime = mimeRaw.isEmpty() ? (isAdap ? "audio/mp4" : "video/mp4") : mimeRaw.split(";")[0].trim();
                    return new ResolvedStream(
                            candUrl,
                            mime,
                            ua,
                            System.currentTimeMillis() + STREAM_CACHE_TTL_MS,
                            extractJsonCodecLabel(mimeRaw),
                            effectiveFormatBitrate(f),
                            isAdap
                    );
                }
            }
        } catch (Exception ignored) {
        }
        return null;
    }

    private WebResourceResponse proxyStreamResponse(
            ResolvedStream stream,
            String cacheKey,
            String rawTrackId,
            String qTitle,
            String qArtist,
            int qDurSec,
            String qQuality,
            Map<String, String> baseCorsHeaders,
            Map<String, String> reqHeaders,
            String method
    ) {
        String clientRange = getHeaderIgnoreCase(reqHeaders, "range");
        boolean hasClientRange = clientRange != null && !clientRange.trim().isEmpty();
        String rangeToSend = null;
        boolean isLowQuality = "low".equals(qQuality);
        long chunkSpanBytes = isLowQuality ? 262143L : 1572863L;
        if (hasClientRange) {
            rangeToSend = clientRange.trim();
            Matcher om = OPEN_RANGE_PATTERN.matcher(rangeToSend);
            if (om.matches()) {
                try {
                    long startByte = Long.parseLong(om.group(1));
                    long endByte = startByte + chunkSpanBytes;
                    rangeToSend = "bytes=" + startByte + "-" + endByte;
                } catch (Exception ignored) {
                }
            }
        }
        boolean isHead = "HEAD".equalsIgnoreCase(method);

        ResolvedStream active = stream;
        for (int attempt = 0; attempt < 2; attempt++) {
            HttpURLConnection conn = null;
            try {
                URL url = new URL(active.url);
                conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod(isHead ? "HEAD" : "GET");
                conn.setConnectTimeout(isLowQuality ? 18000 : 10000);
                conn.setReadTimeout(isLowQuality ? 45000 : 25000);
                conn.setInstanceFollowRedirects(true);
                conn.setRequestProperty("User-Agent", active.userAgent);
                if (rangeToSend != null) {
                    conn.setRequestProperty("Range", rangeToSend);
                }
                conn.setRequestProperty("Accept", "*/*");
                conn.setRequestProperty("Connection", "close");

                int code = conn.getResponseCode();
                if (code == 200 || code == 206) {
                    Map<String, String> respHeaders = new HashMap<String, String>(baseCorsHeaders);
                    respHeaders.put("Accept-Ranges", "bytes");
                    respHeaders.put("Cache-Control", "no-cache");
                    respHeaders.put("X-PMusic-Stream-Source", "youtube-full-android");
                    respHeaders.put("X-PMusic-Stream-Quality", qQuality);
                    if (!active.codec.isEmpty()) respHeaders.put("X-PMusic-Stream-Codec", active.codec);
                    if (active.bitrate > 0L) respHeaders.put("X-PMusic-Stream-Bitrate", String.valueOf(active.bitrate));

                    String upstreamLen = conn.getHeaderField("Content-Length");
                    String upstreamRange = conn.getHeaderField("Content-Range");
                    int outStatus = code;
                    String outReason = code == 206 ? "Partial Content" : "OK";

                    if (!hasClientRange && code == 206) {
                        outStatus = 200;
                        outReason = "OK";
                        if (upstreamLen != null) respHeaders.put("Content-Length", upstreamLen);
                    } else {
                        if (upstreamLen != null) respHeaders.put("Content-Length", upstreamLen);
                        if (upstreamRange != null) respHeaders.put("Content-Range", upstreamRange);
                    }

                    if (isHead) {
                        conn.disconnect();
                        return new WebResourceResponse(active.mime, null, outStatus, outReason, respHeaders, new ByteArrayInputStream(new byte[0]));
                    }
                    InputStream wrapped = new HttpStreamWrapper(conn, conn.getInputStream());
                    return new WebResourceResponse(active.mime, null, outStatus, outReason, respHeaders, wrapped);
                }
                conn.disconnect();
                if ((code == 403 || code == 410) && attempt == 0) {
                    synchronized (fullStreamCache) {
                        fullStreamCache.remove(cacheKey);
                    }
                    ResolvedStream refreshed = getOrResolveFullStream(cacheKey, rawTrackId, qTitle, qArtist, qDurSec, qQuality);
                    if (refreshed == null) return null;
                    active = refreshed;
                } else {
                    return null;
                }
            } catch (Exception ignored) {
                if (conn != null) {
                    try {
                        conn.disconnect();
                    } catch (Exception ignored2) {
                    }
                }
                if (attempt == 0) {
                    synchronized (fullStreamCache) {
                        fullStreamCache.remove(cacheKey);
                    }
                    ResolvedStream refreshed = getOrResolveFullStream(cacheKey, rawTrackId, qTitle, qArtist, qDurSec, qQuality);
                    if (refreshed == null) return null;
                    active = refreshed;
                }
            }
        }
        return null;
    }

    private String getHeaderIgnoreCase(Map<String, String> headers, String targetKey) {
        if (headers == null) return null;
        for (Map.Entry<String, String> entry : headers.entrySet()) {
            if (targetKey.equalsIgnoreCase(entry.getKey())) {
                return entry.getValue();
            }
        }
        return null;
    }

    private static String normText(String s) {
        if (s == null) return "";
        String n = Normalizer.normalize(s.toLowerCase(Locale.ROOT), Normalizer.Form.NFD);
        return n.replaceAll("[\\\\p{InCombiningDiacriticalMarks}]+", "")
                .replaceAll("[^a-z0-9\\\\s]+", " ")
                .replaceAll("\\\\s+", " ")
                .trim();
    }

    private static List<String> tokenizeNorm(String s) {
        String n = normText(s);
        if (n.isEmpty()) return Collections.emptyList();
        return Arrays.asList(n.split(" "));
    }

    private static int parseDurationSec(String text) {
        if (text == null) return 0;
        String clean = text.trim();
        if (!DURATION_TOKEN_PATTERN.matcher(clean).matches()) return 0;
        String[] parts = clean.split(":");
        try {
            if (parts.length == 2) {
                return Integer.parseInt(parts[0]) * 60 + Integer.parseInt(parts[1]);
            }
            if (parts.length == 3) {
                return Integer.parseInt(parts[0]) * 3600 + Integer.parseInt(parts[1]) * 60 + Integer.parseInt(parts[2]);
            }
        } catch (Exception ignored) {
        }
        return 0;
    }

    private static int scoreAudioCandidate(
            String targetTitle,
            String targetArtist,
            int targetDurSec,
            String candTitle,
            String candSubtext,
            int candDurSec,
            boolean isYtMusicSong
    ) {
        String rawNormTitle = normText(targetTitle);
        String candNorm = normText(candTitle);
        if (candNorm.isEmpty() || candDurSec < 40) return -100;
        if (hasDisallowedVersion(targetTitle, candTitle + " " + candSubtext)) {
            return -50;
        }

        List<String> tTokens = new ArrayList<String>();
        for (String tok : tokenizeNorm(targetTitle)) {
            if (tok.length() > 1) tTokens.add(tok);
        }
        if (tTokens.isEmpty()) tTokens = tokenizeNorm(targetTitle);

        int titleHits = 0;
        for (int i = 0; i < tTokens.size(); i++) {
            if (candNorm.contains(tTokens.get(i))) titleHits++;
        }
        double titleRatio = tTokens.isEmpty() ? 0.0 : (double) titleHits / (double) tTokens.size();

        int score = 0;
        if (REMIX_PATTERN.matcher(rawNormTitle).find()) {
            if (REMIX_PATTERN.matcher(normText(candTitle + " " + candSubtext)).find()) score += 8;
            else score -= 6;
        }
        if (candNorm.equals(rawNormTitle) || (!rawNormTitle.isEmpty() && candNorm.contains(rawNormTitle))) {
            score += 10;
        } else if (titleRatio >= 0.6) {
            score += 8;
        } else if (titleRatio >= 0.35) {
            score += 4;
        } else {
            score -= 8;
        }

        String combined = normText(candTitle + " " + candSubtext);
        List<String> aTokens = new ArrayList<String>();
        for (String tok : tokenizeNorm(targetArtist)) {
            if (tok.length() > 1) aTokens.add(tok);
        }
        boolean artistHit = false;
        for (int i = 0; i < aTokens.size(); i++) {
            if (combined.contains(aTokens.get(i))) {
                artistHit = true;
                break;
            }
        }
        if (!artistHit) {
            String normArt = normText(targetArtist);
            if ((normArt.contains("cruz cafune") && combined.contains("cruzzi"))
                    || (normArt.contains("cruzzi") && combined.contains("cruz cafune"))
                    || (normArt.contains("la pantera") && combined.contains("lapantera"))
                    || (normArt.contains("bad bunny") && combined.contains("benito"))
                    || (normArt.contains("d valentino") && combined.contains("dvalentino"))
                    || (normArt.contains("lucho rk") && combined.contains("luchork"))) {
                artistHit = true;
            }
        }
        if (artistHit) {
            score += 6;
        } else if (!aTokens.isEmpty()) {
            score -= 6;
        }

        int diff = Math.abs(candDurSec - targetDurSec);
        if (targetDurSec >= 45) {
            int maxAllowedDiff = Math.max(40, (int) Math.round(targetDurSec * 0.45));
            if (diff > maxAllowedDiff) return -100;
        }
        if (diff <= 8) score += 6;
        else if (diff <= 18) score += 3;
        else if (diff > 45) score -= 12;

        if (isYtMusicSong) score += 2;
        return score;
    }

    private static void collectObjectsByKey(Object node, String targetKey, List<JSONObject> out) {
        if (out.size() >= 25 || node == null) return;
        if (node instanceof JSONObject) {
            JSONObject obj = (JSONObject) node;
            if (obj.has(targetKey)) {
                JSONObject hit = obj.optJSONObject(targetKey);
                if (hit != null) out.add(hit);
            }
            Iterator<String> keys = obj.keys();
            while (keys.hasNext()) {
                collectObjectsByKey(obj.opt(keys.next()), targetKey, out);
            }
        } else if (node instanceof JSONArray) {
            JSONArray arr = (JSONArray) node;
            for (int i = 0; i < arr.length(); i++) {
                collectObjectsByKey(arr.opt(i), targetKey, out);
            }
        }
    }

    private static String findFirstStringByKey(Object node, String targetKey) {
        if (node == null) return null;
        if (node instanceof JSONObject) {
            JSONObject obj = (JSONObject) node;
            String v = obj.optString(targetKey, null);
            if (v != null && !v.isEmpty()) return v;
            Iterator<String> keys = obj.keys();
            while (keys.hasNext()) {
                String found = findFirstStringByKey(obj.opt(keys.next()), targetKey);
                if (found != null) return found;
            }
        } else if (node instanceof JSONArray) {
            JSONArray arr = (JSONArray) node;
            for (int i = 0; i < arr.length(); i++) {
                String found = findFirstStringByKey(arr.opt(i), targetKey);
                if (found != null) return found;
            }
        }
        return null;
    }

    private static String extractFlexColumnText(JSONObject col) {
        if (col == null) return "";
        JSONObject inner = col.optJSONObject("musicResponsiveListItemFlexColumnRenderer");
        if (inner == null) inner = col.optJSONObject("musicResponsiveListItemFixedColumnRenderer");
        if (inner != null) return extractRunsText(inner);
        return extractRunsText(col);
    }

    private static String extractRunsText(JSONObject container) {
        if (container == null) return "";
        JSONObject textObj = container.optJSONObject("text");
        if (textObj == null) textObj = container;
        String simple = textObj.optString("simpleText", "");
        if (!simple.isEmpty()) return simple.trim();
        JSONArray runs = textObj.optJSONArray("runs");
        if (runs == null) return "";
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < runs.length(); i++) {
            JSONObject r = runs.optJSONObject(i);
            if (r != null) sb.append(r.optString("text", ""));
        }
        return sb.toString().trim();
    }

    private byte[] postJsonBytes(String urlStr, String userAgent, String origin, String jsonBody) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(urlStr);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setDoOutput(true);
            conn.setConnectTimeout(6500);
            conn.setReadTimeout(9500);
            conn.setInstanceFollowRedirects(true);
            conn.setRequestProperty("User-Agent", userAgent);
            conn.setRequestProperty("Origin", origin);
            conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
            byte[] bodyBytes = jsonBody.getBytes(StandardCharsets.UTF_8);
            conn.setRequestProperty("Content-Length", String.valueOf(bodyBytes.length));
            OutputStream os = conn.getOutputStream();
            os.write(bodyBytes);
            os.flush();
            os.close();
            int code = conn.getResponseCode();
            if (code >= 200 && code < 300) {
                InputStream in = conn.getInputStream();
                ByteArrayOutputStream bos = new ByteArrayOutputStream();
                byte[] buf = new byte[8192];
                int r;
                while ((r = in.read(buf)) != -1) {
                    bos.write(buf, 0, r);
                }
                in.close();
                return bos.toByteArray();
            }
        } catch (Exception ignored) {
        } finally {
            if (conn != null) conn.disconnect();
        }
        return null;
    }

    private WebResourceResponse buildAudioStreamResponse(
            byte[] audioBytes,
            String mime,
            Map<String, String> corsHeaders,
            Map<String, String> reqHeaders
    ) {
        corsHeaders.put("Accept-Ranges", "bytes");
        int total = audioBytes.length;
        String rangeHeader = null;
        if (reqHeaders != null) {
            for (Map.Entry<String, String> entry : reqHeaders.entrySet()) {
                if ("range".equalsIgnoreCase(entry.getKey())) {
                    rangeHeader = entry.getValue();
                    break;
                }
            }
        }
        if (rangeHeader != null && rangeHeader.startsWith("bytes=")) {
            String spec = rangeHeader.substring("bytes=".length()).trim();
            int commaIdx = spec.indexOf(',');
            if (commaIdx >= 0) spec = spec.substring(0, commaIdx).trim();
            String[] parts = spec.split("-", -1);
            try {
                int start = 0;
                int end = total - 1;
                boolean valid = false;
                if (parts.length == 2 && total > 0) {
                    if (!parts[0].isEmpty() && !parts[1].isEmpty()) {
                        start = Integer.parseInt(parts[0]);
                        end = Math.min(total - 1, Integer.parseInt(parts[1]));
                        valid = start >= 0 && start <= end;
                    } else if (!parts[0].isEmpty()) {
                        start = Integer.parseInt(parts[0]);
                        end = total - 1;
                        valid = start >= 0 && start <= end;
                    } else if (!parts[1].isEmpty()) {
                        int suffix = Integer.parseInt(parts[1]);
                        start = Math.max(0, total - suffix);
                        end = total - 1;
                        valid = suffix > 0 && start <= end;
                    }
                }
                if (valid) {
                    byte[] slice = Arrays.copyOfRange(audioBytes, start, end + 1);
                    corsHeaders.put("Content-Range", "bytes " + start + "-" + end + "/" + total);
                    corsHeaders.put("Content-Length", String.valueOf(slice.length));
                    return new WebResourceResponse(mime, null, 206, "Partial Content", corsHeaders, new ByteArrayInputStream(slice));
                }
                corsHeaders.put("Content-Range", "bytes */" + total);
                return new WebResourceResponse(mime, null, 416, "Range Not Satisfiable", corsHeaders, new ByteArrayInputStream(new byte[0]));
            } catch (Exception ignored) {
            }
        }
        corsHeaders.put("Content-Length", String.valueOf(total));
        return new WebResourceResponse(mime, null, 200, "OK", corsHeaders, new ByteArrayInputStream(audioBytes));
    }

    private byte[] fetchRemoteBytes(String urlStr) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(urlStr);
            conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(3500);
            conn.setReadTimeout(5000);
            conn.setInstanceFollowRedirects(true);
            conn.setRequestProperty("User-Agent", "pMusic-Android/0.13.0");
            int code = conn.getResponseCode();
            if (code >= 200 && code < 300) {
                InputStream in = conn.getInputStream();
                ByteArrayOutputStream bos = new ByteArrayOutputStream();
                byte[] buf = new byte[8192];
                int r;
                while ((r = in.read(buf)) != -1) {
                    bos.write(buf, 0, r);
                }
                in.close();
                return bos.toByteArray();
            }
        } catch (Exception ignored) {
        } finally {
            if (conn != null) conn.disconnect();
        }
        return null;
    }

    private String guessMime(String path) {
        String lower = path.toLowerCase();
        if (lower.endsWith(".html")) return "text/html";
        if (lower.endsWith(".js") || lower.endsWith(".mjs")) return "application/javascript";
        if (lower.endsWith(".css")) return "text/css";
        if (lower.endsWith(".json")) return "application/json";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".woff2")) return "font/woff2";
        if (lower.endsWith(".woff")) return "font/woff";
        if (lower.endsWith(".mp3")) return "audio/mpeg";
        if (lower.endsWith(".wav")) return "audio/wav";
        return "application/octet-stream";
    }

    @Override
    public void onBackPressed() {
        if (webView != null && Build.VERSION.SDK_INT >= 19) {
            webView.evaluateJavascript(
                "(function(){ return Boolean(window.__pmusicHandleAndroidBack && window.__pmusicHandleAndroidBack()); })()",
                new ValueCallback<String>() {
                    @Override
                    public void onReceiveValue(String value) {
                        if ("true".equals(value)) {
                            return;
                        }
                        if (webView.canGoBack()) {
                            webView.goBack();
                        } else if (!isFinishing()) {
                            MainActivity.super.onBackPressed();
                        }
                    }
                }
            );
            return;
        }
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
`,
  'utf-8'
);

writeFileSync(
  resolve(javaSrcDir, 'PMusicApkProvider.java'),
  `package es.pmusic.app;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;

public class PMusicApkProvider extends ContentProvider {
    @Override
    public boolean onCreate() {
        return true;
    }

    private File resolveTarget(Uri uri) {
        if (getContext() == null || uri == null) return null;
        return new File(getContext().getCacheDir(), "pmusic-update.apk");
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        File f = resolveTarget(uri);
        if (f == null || !f.exists()) throw new FileNotFoundException("APK not found");
        return ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public String getType(Uri uri) {
        return "application/vnd.android.package-archive";
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        File f = resolveTarget(uri);
        MatrixCursor mc = new MatrixCursor(new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE});
        if (f != null && f.exists()) {
            mc.addRow(new Object[]{f.getName(), f.length()});
        }
        return mc;
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) { return null; }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) { return 0; }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) { return 0; }
}
`,
  'utf-8'
);

writeFileSync(
  resolve(javaSrcDir, 'PMusicWidgetProvider.java'),
  `package es.pmusic.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.PorterDuff;
import android.graphics.PorterDuffXfermode;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.Shader;
import android.os.Build;
import android.widget.RemoteViews;

public class PMusicWidgetProvider extends AppWidgetProvider {
    public static final String ACTION_WIDGET_PREV = "es.pmusic.app.WIDGET_PREV";
    public static final String ACTION_WIDGET_TOGGLE = "es.pmusic.app.WIDGET_TOGGLE";
    public static final String ACTION_WIDGET_NEXT = "es.pmusic.app.WIDGET_NEXT";

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        updateWidgetIds(
                context,
                appWidgetManager,
                appWidgetIds,
                PMusicPlaybackService.getWidgetTitle(),
                PMusicPlaybackService.getWidgetArtist(),
                PMusicPlaybackService.isCurrentlyPlaying(),
                PMusicPlaybackService.getWidgetCoverBitmap()
        );
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        if (intent == null) return;
        String action = intent.getAction();
        String serviceAction = null;
        String jsAction = null;
        if (ACTION_WIDGET_PREV.equals(action)) {
            serviceAction = PMusicPlaybackService.ACTION_PREV;
            jsAction = "previoustrack";
        } else if (ACTION_WIDGET_TOGGLE.equals(action)) {
            serviceAction = PMusicPlaybackService.ACTION_TOGGLE;
            jsAction = "toggle";
        } else if (ACTION_WIDGET_NEXT.equals(action)) {
            serviceAction = PMusicPlaybackService.ACTION_NEXT;
            jsAction = "nexttrack";
        }
        if (serviceAction == null) return;

        if (PMusicPlaybackService.isServiceActive()) {
            Intent svc = new Intent(context, PMusicPlaybackService.class);
            svc.setAction(serviceAction);
            try {
                if (Build.VERSION.SDK_INT >= 26) {
                    context.startForegroundService(svc);
                } else {
                    context.startService(svc);
                }
            } catch (Throwable ignored) {
            }
        } else {
            Intent openApp = new Intent(context, MainActivity.class);
            openApp.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            openApp.putExtra("pmusic_widget_action", jsAction);
            try {
                context.startActivity(openApp);
            } catch (Throwable ignored) {
            }
        }
    }

    public static void updateAllWidgets(
            Context ctx,
            String title,
            String artist,
            boolean isPlaying,
            Bitmap coverBmp
    ) {
        if (ctx == null) return;
        try {
            AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
            if (mgr == null) return;
            ComponentName cn = new ComponentName(ctx, PMusicWidgetProvider.class);
            int[] ids = mgr.getAppWidgetIds(cn);
            if (ids == null || ids.length == 0) return;
            updateWidgetIds(ctx, mgr, ids, title, artist, isPlaying, coverBmp);
        } catch (Throwable ignored) {
        }
    }

    private static void updateWidgetIds(
            Context ctx,
            AppWidgetManager mgr,
            int[] ids,
            String title,
            String artist,
            boolean isPlaying,
            Bitmap coverBmp
    ) {
        if (ids == null || ids.length == 0) return;
        String safeTitle = (title != null && !title.trim().isEmpty()) ? title.trim() : "pMusic";
        String safeArtist = (artist != null && !artist.trim().isEmpty()) ? artist.trim() : "Toca para reproducir";

        Bitmap bgBmp = coverBmp != null ? createTintedBackgroundBitmap(coverBmp, 384, 180, 38f) : null;
        Bitmap roundedCover = coverBmp != null ? createRoundedCoverBitmap(coverBmp, 160, 26f) : null;

        int piFlags = Build.VERSION.SDK_INT >= 23
                ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                : PendingIntent.FLAG_UPDATE_CURRENT;

        Intent openIntent = new Intent(ctx, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent openPi = PendingIntent.getActivity(ctx, 200, openIntent, piFlags);

        PendingIntent prevPi = makeActionBroadcast(ctx, ACTION_WIDGET_PREV, 201, piFlags);
        PendingIntent togglePi = makeActionBroadcast(ctx, ACTION_WIDGET_TOGGLE, 202, piFlags);
        PendingIntent nextPi = makeActionBroadcast(ctx, ACTION_WIDGET_NEXT, 203, piFlags);

        for (int appWidgetId : ids) {
            RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_pmusic);
            rv.setTextViewText(R.id.widget_title, safeTitle);
            rv.setTextViewText(R.id.widget_artist, safeArtist);
            rv.setImageViewResource(R.id.widget_toggle, isPlaying ? R.drawable.ic_widget_pause_dark : R.drawable.ic_widget_play_dark);

            if (bgBmp != null) {
                rv.setImageViewBitmap(R.id.widget_bg_image, bgBmp);
            } else {
                rv.setImageViewBitmap(R.id.widget_bg_image, null);
            }

            if (roundedCover != null) {
                rv.setImageViewBitmap(R.id.widget_cover, roundedCover);
            } else {
                rv.setImageViewResource(R.id.widget_cover, R.drawable.ic_launcher);
            }

            rv.setOnClickPendingIntent(R.id.widget_root, openPi);
            rv.setOnClickPendingIntent(R.id.widget_cover, openPi);
            rv.setOnClickPendingIntent(R.id.widget_prev, prevPi);
            rv.setOnClickPendingIntent(R.id.widget_toggle, togglePi);
            rv.setOnClickPendingIntent(R.id.widget_next, nextPi);

            mgr.updateAppWidget(appWidgetId, rv);
        }
    }

    public static PendingIntent makeActionBroadcast(Context ctx, String action, int reqCode, int flags) {
        Intent i = new Intent(ctx, PMusicWidgetProvider.class);
        i.setAction(action);
        return PendingIntent.getBroadcast(ctx, reqCode, i, flags);
    }

    public static Bitmap createRoundedCoverBitmap(Bitmap src, int sizePx, float radiusPx) {
        if (src == null || src.isRecycled()) return null;
        try {
            Bitmap scaled = Bitmap.createScaledBitmap(src, sizePx, sizePx, true);
            Bitmap out = Bitmap.createBitmap(sizePx, sizePx, Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(out);
            Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
            Rect rect = new Rect(0, 0, sizePx, sizePx);
            RectF rectF = new RectF(rect);
            canvas.drawARGB(0, 0, 0, 0);
            canvas.drawRoundRect(rectF, radiusPx, radiusPx, paint);
            paint.setXfermode(new PorterDuffXfermode(PorterDuff.Mode.SRC_IN));
            canvas.drawBitmap(scaled, rect, rect, paint);
            return out;
        } catch (Throwable t) {
            return null;
        }
    }

    public static Bitmap createTintedBackgroundBitmap(Bitmap src) {
        return createTintedBackgroundBitmap(src, 384, 180, 38f);
    }

    public static Bitmap createTintedBackgroundBitmap(Bitmap src, int outW, int outH, float cornerPx) {
        if (src == null || src.isRecycled()) return null;
        try {
            Bitmap tiny = Bitmap.createScaledBitmap(src, 8, 8, true);
            long rSum = 0L, gSum = 0L, bSum = 0L;
            int count = 0;
            for (int y = 0; y < tiny.getHeight(); y++) {
                for (int x = 0; x < tiny.getWidth(); x++) {
                    int c = tiny.getPixel(x, y);
                    rSum += Color.red(c);
                    gSum += Color.green(c);
                    bSum += Color.blue(c);
                    count++;
                }
            }
            int avgR = count > 0 ? (int) (rSum / count) : 28;
            int avgG = count > 0 ? (int) (gSum / count) : 28;
            int avgB = count > 0 ? (int) (bSum / count) : 42;

            int startColor = Color.argb(248, Math.min(92, Math.max(22, (int) (avgR * 0.46))), Math.min(92, Math.max(22, (int) (avgG * 0.46))), Math.min(108, Math.max(26, (int) (avgB * 0.50))));
            int endColor = Color.argb(252, Math.min(28, Math.max(10, (int) (avgR * 0.14))), Math.min(28, Math.max(10, (int) (avgG * 0.14))), Math.min(34, Math.max(14, (int) (avgB * 0.16))));

            int w = Math.max(64, outW);
            int h = Math.max(48, outH);
            Bitmap out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
            Canvas c = new Canvas(out);
            Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
            p.setShader(new LinearGradient(0f, 0f, w, h, startColor, endColor, Shader.TileMode.CLAMP));
            if (cornerPx > 0f) {
                c.drawRoundRect(new RectF(0f, 0f, w, h), cornerPx, cornerPx, p);
            } else {
                c.drawRect(0f, 0f, w, h, p);
            }
            return out;
        } catch (Throwable t) {
            return null;
        }
    }
}
`,
  'utf-8'
);

writeFileSync(
  resolve(javaSrcDir, 'PMusicCompactWidgetProvider.java'),
  `package es.pmusic.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.os.Build;
import android.widget.RemoteViews;

public class PMusicCompactWidgetProvider extends AppWidgetProvider {
    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        updateWidgetIds(
                context,
                appWidgetManager,
                appWidgetIds,
                PMusicPlaybackService.getWidgetTitle(),
                PMusicPlaybackService.getWidgetArtist(),
                PMusicPlaybackService.isCurrentlyPlaying(),
                PMusicPlaybackService.getWidgetCoverBitmap()
        );
    }

    public static void updateAllWidgets(
            Context ctx,
            String title,
            String artist,
            boolean isPlaying,
            Bitmap coverBmp
    ) {
        if (ctx == null) return;
        try {
            AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
            if (mgr == null) return;
            ComponentName cn = new ComponentName(ctx, PMusicCompactWidgetProvider.class);
            int[] ids = mgr.getAppWidgetIds(cn);
            if (ids == null || ids.length == 0) return;
            updateWidgetIds(ctx, mgr, ids, title, artist, isPlaying, coverBmp);
        } catch (Throwable ignored) {
        }
    }

    private static void updateWidgetIds(
            Context ctx,
            AppWidgetManager mgr,
            int[] ids,
            String title,
            String artist,
            boolean isPlaying,
            Bitmap coverBmp
    ) {
        if (ids == null || ids.length == 0) return;
        String safeTitle = (title != null && !title.trim().isEmpty()) ? title.trim() : "pMusic";
        String safeArtist = (artist != null && !artist.trim().isEmpty()) ? artist.trim() : "Toca para reproducir";

        Bitmap bgBmp = coverBmp != null ? PMusicWidgetProvider.createTintedBackgroundBitmap(coverBmp, 384, 88, 36f) : null;
        Bitmap roundedCover = coverBmp != null ? PMusicWidgetProvider.createRoundedCoverBitmap(coverBmp, 128, 22f) : null;

        int piFlags = Build.VERSION.SDK_INT >= 23
                ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                : PendingIntent.FLAG_UPDATE_CURRENT;

        Intent openIntent = new Intent(ctx, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent openPi = PendingIntent.getActivity(ctx, 210, openIntent, piFlags);

        PendingIntent prevPi = PMusicWidgetProvider.makeActionBroadcast(ctx, PMusicWidgetProvider.ACTION_WIDGET_PREV, 211, piFlags);
        PendingIntent togglePi = PMusicWidgetProvider.makeActionBroadcast(ctx, PMusicWidgetProvider.ACTION_WIDGET_TOGGLE, 212, piFlags);
        PendingIntent nextPi = PMusicWidgetProvider.makeActionBroadcast(ctx, PMusicWidgetProvider.ACTION_WIDGET_NEXT, 213, piFlags);

        for (int appWidgetId : ids) {
            RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_pmusic_compact);
            rv.setTextViewText(R.id.widget_title, safeTitle);
            rv.setTextViewText(R.id.widget_artist, safeArtist);
            rv.setImageViewResource(R.id.widget_toggle, isPlaying ? R.drawable.ic_widget_pause_dark : R.drawable.ic_widget_play_dark);
            rv.setImageViewBitmap(R.id.widget_bg_image, bgBmp);
            if (roundedCover != null) {
                rv.setImageViewBitmap(R.id.widget_cover, roundedCover);
            } else {
                rv.setImageViewResource(R.id.widget_cover, R.drawable.ic_launcher);
            }
            rv.setOnClickPendingIntent(R.id.widget_root, openPi);
            rv.setOnClickPendingIntent(R.id.widget_cover, openPi);
            rv.setOnClickPendingIntent(R.id.widget_prev, prevPi);
            rv.setOnClickPendingIntent(R.id.widget_toggle, togglePi);
            rv.setOnClickPendingIntent(R.id.widget_next, nextPi);
            mgr.updateAppWidget(appWidgetId, rv);
        }
    }
}
`,
  'utf-8'
);

writeFileSync(
  resolve(javaSrcDir, 'PMusicRecentWidgetProvider.java'),
  `package es.pmusic.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.os.Build;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.concurrent.ConcurrentHashMap;

public class PMusicRecentWidgetProvider extends AppWidgetProvider {
    private static final ConcurrentHashMap<String, Bitmap> thumbCache = new ConcurrentHashMap<String, Bitmap>();
    private static final int[] BOX_IDS = new int[]{
            R.id.widget_recent_box_0,
            R.id.widget_recent_box_1,
            R.id.widget_recent_box_2,
            R.id.widget_recent_box_3
    };
    private static final int[] IMG_IDS = new int[]{
            R.id.widget_recent_img_0,
            R.id.widget_recent_img_1,
            R.id.widget_recent_img_2,
            R.id.widget_recent_img_3
    };
    private static final int[] TXT_IDS = new int[]{
            R.id.widget_recent_txt_0,
            R.id.widget_recent_txt_1,
            R.id.widget_recent_txt_2,
            R.id.widget_recent_txt_3
    };
    private static final String[] DEFAULT_LABELS = new String[]{"Inicio", "Mix", "Música", "pMusic"};

    public static Bitmap getCachedThumb(String coverUrl) {
        if (coverUrl == null || coverUrl.trim().isEmpty()) return null;
        Bitmap bmp = thumbCache.get(coverUrl);
        if (bmp != null && bmp.isRecycled()) {
            thumbCache.remove(coverUrl);
            return null;
        }
        return bmp;
    }

    public static void putCachedThumb(String coverUrl, Bitmap bmp) {
        if (coverUrl == null || coverUrl.trim().isEmpty() || bmp == null || bmp.isRecycled()) return;
        Bitmap rounded = PMusicWidgetProvider.createRoundedCoverBitmap(bmp, 128, 22f);
        if (thumbCache.size() > 24) {
            thumbCache.clear();
        }
        thumbCache.put(coverUrl, rounded != null ? rounded : bmp);
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        updateWidgetIds(
                context,
                appWidgetManager,
                appWidgetIds,
                PMusicPlaybackService.getWidgetTitle(),
                PMusicPlaybackService.getWidgetArtist(),
                PMusicPlaybackService.isCurrentlyPlaying(),
                PMusicPlaybackService.getWidgetCoverBitmap()
        );
    }

    public static void updateAllWidgets(
            Context ctx,
            String title,
            String artist,
            boolean isPlaying,
            Bitmap coverBmp
    ) {
        if (ctx == null) return;
        try {
            AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
            if (mgr == null) return;
            ComponentName cn = new ComponentName(ctx, PMusicRecentWidgetProvider.class);
            int[] ids = mgr.getAppWidgetIds(cn);
            if (ids == null || ids.length == 0) return;
            updateWidgetIds(ctx, mgr, ids, title, artist, isPlaying, coverBmp);
        } catch (Throwable ignored) {
        }
    }

    private static void updateWidgetIds(
            Context ctx,
            AppWidgetManager mgr,
            int[] ids,
            String title,
            String artist,
            boolean isPlaying,
            Bitmap coverBmp
    ) {
        if (ids == null || ids.length == 0) return;
        String safeTitle = (title != null && !title.trim().isEmpty()) ? title.trim() : "pMusic";
        String safeArtist = (artist != null && !artist.trim().isEmpty()) ? artist.trim() : "Recientes";

        Bitmap bgBmp = coverBmp != null ? PMusicWidgetProvider.createTintedBackgroundBitmap(coverBmp, 384, 210, 38f) : null;
        Bitmap roundedCover = coverBmp != null ? PMusicWidgetProvider.createRoundedCoverBitmap(coverBmp, 120, 20f) : null;

        JSONArray recentsArr = new JSONArray();
        try {
            SharedPreferences prefs = ctx.getSharedPreferences("pmusic_widget_recents", Context.MODE_PRIVATE);
            String json = prefs.getString("items_json", "[]");
            recentsArr = new JSONArray(json);
        } catch (Throwable ignored) {
        }

        int piFlags = Build.VERSION.SDK_INT >= 23
                ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                : PendingIntent.FLAG_UPDATE_CURRENT;

        Intent openIntent = new Intent(ctx, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent openPi = PendingIntent.getActivity(ctx, 220, openIntent, piFlags);
        PendingIntent togglePi = PMusicWidgetProvider.makeActionBroadcast(ctx, PMusicWidgetProvider.ACTION_WIDGET_TOGGLE, 221, piFlags);

        for (int appWidgetId : ids) {
            RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_pmusic_recent);
            rv.setTextViewText(R.id.widget_title, safeTitle);
            rv.setTextViewText(R.id.widget_artist, safeArtist);
            rv.setImageViewResource(R.id.widget_toggle, isPlaying ? R.drawable.ic_widget_pause_dark : R.drawable.ic_widget_play_dark);
            rv.setImageViewBitmap(R.id.widget_bg_image, bgBmp);
            if (roundedCover != null) {
                rv.setImageViewBitmap(R.id.widget_cover, roundedCover);
            } else {
                rv.setImageViewResource(R.id.widget_cover, R.drawable.ic_launcher);
            }
            rv.setOnClickPendingIntent(R.id.widget_root, openPi);
            rv.setOnClickPendingIntent(R.id.widget_cover, openPi);
            rv.setOnClickPendingIntent(R.id.widget_toggle, togglePi);

            for (int i = 0; i < 4; i++) {
                JSONObject item = i < recentsArr.length() ? recentsArr.optJSONObject(i) : null;
                String itemTitle = item != null ? item.optString("title", "").trim() : "";
                String itemKind = item != null ? item.optString("kind", "").trim() : "";
                String itemId = item != null ? item.optString("id", "").trim() : "";
                String coverUrl = item != null ? item.optString("coverUrl", "").trim() : "";

                rv.setTextViewText(TXT_IDS[i], !itemTitle.isEmpty() ? itemTitle : DEFAULT_LABELS[i]);
                Bitmap thumb = !coverUrl.isEmpty() ? getCachedThumb(coverUrl) : null;
                if (thumb != null) {
                    rv.setImageViewBitmap(IMG_IDS[i], thumb);
                } else {
                    rv.setImageViewResource(IMG_IDS[i], R.drawable.ic_launcher);
                }

                if (!itemId.isEmpty()) {
                    Intent itemIntent = new Intent(ctx, MainActivity.class);
                    itemIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                    itemIntent.putExtra("pmusic_widget_open_kind", itemKind);
                    itemIntent.putExtra("pmusic_widget_open_id", itemId);
                    PendingIntent itemPi = PendingIntent.getActivity(ctx, 230 + i, itemIntent, piFlags);
                    rv.setOnClickPendingIntent(BOX_IDS[i], itemPi);
                } else {
                    rv.setOnClickPendingIntent(BOX_IDS[i], openPi);
                }
            }

            mgr.updateAppWidget(appWidgetId, rv);
        }
    }
}
`,
  'utf-8'
);

writeFileSync(
  resolve(javaSrcDir, 'PMusicCoverWidgetProvider.java'),
  `package es.pmusic.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.os.Build;
import android.widget.RemoteViews;

public class PMusicCoverWidgetProvider extends AppWidgetProvider {
    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        updateWidgetIds(
                context,
                appWidgetManager,
                appWidgetIds,
                PMusicPlaybackService.getWidgetTitle(),
                PMusicPlaybackService.getWidgetArtist(),
                PMusicPlaybackService.isCurrentlyPlaying(),
                PMusicPlaybackService.getWidgetCoverBitmap()
        );
    }

    public static void updateAllWidgets(
            Context ctx,
            String title,
            String artist,
            boolean isPlaying,
            Bitmap coverBmp
    ) {
        if (ctx == null) return;
        try {
            AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
            if (mgr == null) return;
            ComponentName cn = new ComponentName(ctx, PMusicCoverWidgetProvider.class);
            int[] ids = mgr.getAppWidgetIds(cn);
            if (ids == null || ids.length == 0) return;
            updateWidgetIds(ctx, mgr, ids, title, artist, isPlaying, coverBmp);
        } catch (Throwable ignored) {
        }
    }

    private static void updateWidgetIds(
            Context ctx,
            AppWidgetManager mgr,
            int[] ids,
            String title,
            String artist,
            boolean isPlaying,
            Bitmap coverBmp
    ) {
        if (ids == null || ids.length == 0) return;
        String safeTitle = (title != null && !title.trim().isEmpty()) ? title.trim() : "pMusic";
        String safeArtist = (artist != null && !artist.trim().isEmpty()) ? artist.trim() : "Toca para reproducir";

        Bitmap roundedCover = coverBmp != null ? PMusicWidgetProvider.createRoundedCoverBitmap(coverBmp, 320, 44f) : null;

        int piFlags = Build.VERSION.SDK_INT >= 23
                ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                : PendingIntent.FLAG_UPDATE_CURRENT;

        Intent openIntent = new Intent(ctx, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent openPi = PendingIntent.getActivity(ctx, 240, openIntent, piFlags);
        PendingIntent togglePi = PMusicWidgetProvider.makeActionBroadcast(ctx, PMusicWidgetProvider.ACTION_WIDGET_TOGGLE, 241, piFlags);

        for (int appWidgetId : ids) {
            RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_pmusic_cover);
            rv.setTextViewText(R.id.widget_title, safeTitle);
            rv.setTextViewText(R.id.widget_artist, safeArtist);
            rv.setImageViewResource(R.id.widget_toggle, isPlaying ? R.drawable.ic_widget_pause_dark : R.drawable.ic_widget_play_dark);
            if (roundedCover != null) {
                rv.setImageViewBitmap(R.id.widget_cover, roundedCover);
            } else {
                rv.setImageViewResource(R.id.widget_cover, R.drawable.ic_launcher);
            }
            rv.setOnClickPendingIntent(R.id.widget_root, openPi);
            rv.setOnClickPendingIntent(R.id.widget_cover, openPi);
            rv.setOnClickPendingIntent(R.id.widget_toggle, togglePi);
            mgr.updateAppWidget(appWidgetId, rv);
        }
    }
}
`,
  'utf-8'
);

writeFileSync(
  resolve(javaSrcDir, 'PMusicReleaseCheckJobService.java'),
  `package es.pmusic.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.text.Normalizer;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TimeZone;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class PMusicReleaseCheckJobService extends JobService {
    public static final int JOB_ID = 7401;
    public static final String PREFS_NAME = "pmusic_release_prefs";
    public static final String CHANNEL_ID = "pmusic_releases_channel";
    private static final ExecutorService JOB_EXECUTOR = Executors.newSingleThreadExecutor();

    public static void schedulePeriodicCheck(Context ctx, boolean enabled) {
        if (ctx == null || Build.VERSION.SDK_INT < 21) return;
        try {
            JobScheduler scheduler = (JobScheduler) ctx.getSystemService(Context.JOB_SCHEDULER_SERVICE);
            if (scheduler == null) return;
            if (!enabled) {
                scheduler.cancel(JOB_ID);
                return;
            }
            JobInfo.Builder b = new JobInfo.Builder(
                    JOB_ID,
                    new ComponentName(ctx.getApplicationContext(), PMusicReleaseCheckJobService.class)
            )
                    .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                    .setPeriodic(6L * 60L * 60L * 1000L);
            try {
                b.setPersisted(true);
            } catch (Throwable ignored) {
            }
            scheduler.schedule(b.build());
        } catch (Throwable ignored) {
        }
    }

    @Override
    public boolean onStartJob(final JobParameters params) {
        JOB_EXECUTOR.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    runReleaseScan();
                } catch (Throwable ignored) {
                } finally {
                    jobFinished(params, false);
                }
            }
        });
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        return true;
    }

    private void runReleaseScan() {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        if (!prefs.getBoolean("enabled", true)) return;

        JSONArray artistsArr;
        try {
            artistsArr = new JSONArray(prefs.getString("favorite_artists_json", "[]"));
        } catch (Exception e) {
            return;
        }
        if (artistsArr.length() == 0) return;

        Set<String> seenIds = new LinkedHashSet<String>();
        try {
            JSONArray sArr = new JSONArray(prefs.getString("seen_release_ids", "[]"));
            for (int i = 0; i < sArr.length(); i++) {
                String v = sArr.optString(i, "");
                if (!v.isEmpty()) seenIds.add(v);
            }
        } catch (Exception ignored) {
        }

        SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
        sdf.setTimeZone(TimeZone.getTimeZone("UTC"));
        long nowMs = System.currentTimeMillis();
        String todayIso = sdf.format(new Date(nowMs));
        String cutoff3Iso = sdf.format(new Date(nowMs - 3L * 86400000L));

        Map<String, String> artistDisplayByNorm = new HashMap<String, String>();
        for (int i = 0; i < Math.min(15, artistsArr.length()); i++) {
            JSONObject aObj = artistsArr.optJSONObject(i);
            if (aObj == null) continue;
            String name = aObj.optString("name", "").trim();
            String norm = normStr(name);
            if (!norm.isEmpty() && !artistDisplayByNorm.containsKey(norm)) {
                artistDisplayByNorm.put(norm, name);
            }
        }

        int notifiedCount = 0;

        // 1. Cross-check curated Release Radar against user's priority artists
        String radarText = httpGetText("https://pmusic-olive.vercel.app/api/release-radar", 5500);
        if (radarText != null && !radarText.isEmpty()) {
            try {
                JSONObject radarJson = new JSONObject(radarText);
                JSONArray releases = radarJson.optJSONArray("releases");
                if (releases != null) {
                    for (int i = 0; i < releases.length() && notifiedCount < 3; i++) {
                        JSONObject rel = releases.optJSONObject(i);
                        if (rel == null) continue;
                        String rd = rel.optString("releaseDate", "");
                        if (rd.length() >= 10) rd = rd.substring(0, 10);
                        if (rd.length() != 10 || rd.compareTo(cutoff3Iso) < 0 || rd.compareTo(todayIso) > 0) continue;
                        String title = rel.optString("title", "").trim();
                        if (title.isEmpty()) continue;
                        JSONArray relArtists = rel.optJSONArray("artists");
                        String matchedArtist = null;
                        if (relArtists != null) {
                            for (int k = 0; k < relArtists.length(); k++) {
                                String an = relArtists.optString(k, "").trim();
                                if (artistDisplayByNorm.containsKey(normStr(an))) {
                                    matchedArtist = an;
                                    break;
                                }
                            }
                        }
                        if (matchedArtist == null) continue;
                        String relId = "radar:" + normStr(matchedArtist) + ":" + normStr(title) + ":" + rd;
                        if (seenIds.contains(relId)) continue;

                        JSONObject trackObj = rel.optJSONObject("track");
                        String trackId = trackObj != null ? trackObj.optString("id", "") : "";
                        String albumId = "";
                        if (trackObj != null && trackObj.optJSONObject("album") != null) {
                            albumId = trackObj.optJSONObject("album").optString("id", "");
                        }
                        String cover = rel.optString("thumbnailHighUrl", rel.optString("thumbnailUrl", ""));
                        Bitmap bmp = downloadBitmap(cover);
                        postReleaseNotification(
                                getApplicationContext(),
                                "Nuevo de " + matchedArtist,
                                title + " · Toca para escuchar",
                                trackId,
                                albumId,
                                title,
                                matchedArtist,
                                cover,
                                bmp
                        );
                        seenIds.add(relId);
                        notifiedCount++;
                    }
                }
            } catch (Throwable ignored) {
            }
        }

        // 2. Query user's top favorite / most-played artists directly on Deezer
        for (int i = 0; i < Math.min(10, artistsArr.length()) && notifiedCount < 3; i++) {
            JSONObject aObj = artistsArr.optJSONObject(i);
            if (aObj == null) continue;
            String artistName = aObj.optString("name", "").trim();
            String artistId = aObj.optString("artistId", "").trim();
            if (artistName.isEmpty()) continue;

            if (artistId.isEmpty() || !artistId.matches("\\\\d+")) {
                try {
                    String sUrl = "https://api.deezer.com/search/artist?q=" + URLEncoder.encode(artistName, "UTF-8") + "&limit=3";
                    String sTxt = httpGetText(sUrl, 4000);
                    if (sTxt != null) {
                        JSONArray hits = new JSONObject(sTxt).optJSONArray("data");
                        if (hits != null && hits.length() > 0) {
                            artistId = String.valueOf(hits.optJSONObject(0).optLong("id", 0));
                        }
                    }
                } catch (Throwable ignored) {
                }
            }
            if (artistId.isEmpty() || "0".equals(artistId)) continue;

            String alTxt = httpGetText("https://api.deezer.com/artist/" + artistId + "/albums?limit=5", 4500);
            if (alTxt == null) continue;
            try {
                JSONArray albums = new JSONObject(alTxt).optJSONArray("data");
                if (albums == null) continue;
                for (int j = 0; j < albums.length() && notifiedCount < 3; j++) {
                    JSONObject al = albums.optJSONObject(j);
                    if (al == null) continue;
                    String rd = al.optString("release_date", "");
                    if (rd.length() >= 10) rd = rd.substring(0, 10);
                    if (rd.length() != 10 || rd.compareTo(cutoff3Iso) < 0 || rd.compareTo(todayIso) > 0) continue;
                    long alIdNum = al.optLong("id", 0L);
                    String title = al.optString("title", "").trim();
                    if (alIdNum <= 0 || title.isEmpty()) continue;
                    String alId = String.valueOf(alIdNum);
                    String relId = "dz-al:" + alId + ":" + rd;
                    if (seenIds.contains(relId)) continue;

                    String firstTrackId = "";
                    String trTxt = httpGetText("https://api.deezer.com/album/" + alId + "/tracks?limit=1", 3500);
                    if (trTxt != null) {
                        try {
                            JSONArray trArr = new JSONObject(trTxt).optJSONArray("data");
                            if (trArr != null && trArr.length() > 0) {
                                long tid = trArr.optJSONObject(0).optLong("id", 0L);
                                if (tid > 0) firstTrackId = "dz_" + tid;
                            }
                        } catch (Exception ignored) {
                        }
                    }

                    String cover = al.optString("cover_big", al.optString("cover_medium", al.optString("cover", "")));
                    Bitmap bmp = downloadBitmap(cover);
                    postReleaseNotification(
                            getApplicationContext(),
                            "Nuevo de " + artistName,
                            title + " · Toca para escuchar",
                            firstTrackId,
                            alId,
                            title,
                            artistName,
                            cover,
                            bmp
                    );
                    seenIds.add(relId);
                    notifiedCount++;
                }
            } catch (Throwable ignored) {
            }
        }

        JSONArray outSeen = new JSONArray();
        int skip = Math.max(0, seenIds.size() - 200);
        int idx = 0;
        for (String s : seenIds) {
            if (idx++ >= skip) outSeen.put(s);
        }
        prefs.edit()
                .putString("seen_release_ids", outSeen.toString())
                .putLong("last_bg_check_ms", nowMs)
                .apply();
    }

    public static void postReleaseNotification(
            Context ctx,
            String notifTitle,
            String notifBody,
            String trackId,
            String albumId,
            String itemTitle,
            String itemArtist,
            String coverUrl,
            Bitmap coverBmp
    ) {
        if (ctx == null) return;
        try {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            if (Build.VERSION.SDK_INT >= 26) {
                NotificationChannel ch = new NotificationChannel(
                        CHANNEL_ID,
                        "Nuevos lanzamientos",
                        NotificationManager.IMPORTANCE_DEFAULT
                );
                nm.createNotificationChannel(ch);
            }
            Intent openIntent = new Intent(ctx, MainActivity.class);
            openIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            openIntent.putExtra("pmusic_release_track_id", trackId != null ? trackId.trim() : "");
            openIntent.putExtra("pmusic_release_album_id", albumId != null ? albumId.trim() : "");
            openIntent.putExtra("pmusic_release_title", itemTitle != null ? itemTitle.trim() : "");
            openIntent.putExtra("pmusic_release_artist", itemArtist != null ? itemArtist.trim() : "");
            openIntent.putExtra("pmusic_release_cover", coverUrl != null ? coverUrl.trim() : "");

            int reqCode = 5100 + Math.abs((notifTitle + "|" + notifBody).hashCode() % 400);
            int piFlags = Build.VERSION.SDK_INT >= 23
                    ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                    : PendingIntent.FLAG_UPDATE_CURRENT;
            PendingIntent pi = PendingIntent.getActivity(ctx, reqCode, openIntent, piFlags);

            Notification.Builder nb = Build.VERSION.SDK_INT >= 26
                    ? new Notification.Builder(ctx, CHANNEL_ID)
                    : new Notification.Builder(ctx);
            nb.setSmallIcon(R.drawable.ic_stat_pmusic)
                    .setContentTitle(notifTitle)
                    .setContentText(notifBody)
                    .setColor(0xFF070709)
                    .setAutoCancel(true)
                    .setContentIntent(pi);
            if (coverBmp != null) {
                nb.setLargeIcon(coverBmp);
            }
            nm.notify(reqCode, nb.build());
        } catch (Throwable ignored) {
        }
    }

    public static Bitmap downloadBitmap(String urlStr) {
        if (urlStr == null || !urlStr.startsWith("https://")) return null;
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(urlStr).openConnection();
            conn.setConnectTimeout(3500);
            conn.setReadTimeout(4500);
            conn.setInstanceFollowRedirects(true);
            conn.setRequestProperty("User-Agent", "pMusic-Android/0.24.9");
            if (conn.getResponseCode() < 200 || conn.getResponseCode() >= 300) return null;
            InputStream in = conn.getInputStream();
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) != -1) bos.write(buf, 0, n);
            in.close();
            byte[] bytes = bos.toByteArray();
            return BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
        } catch (Throwable ignored) {
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static String httpGetText(String urlStr, int timeoutMs) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(urlStr).openConnection();
            conn.setConnectTimeout(timeoutMs);
            conn.setReadTimeout(timeoutMs);
            conn.setInstanceFollowRedirects(true);
            conn.setRequestProperty("User-Agent", "pMusic-Android/0.24.9");
            if (conn.getResponseCode() < 200 || conn.getResponseCode() >= 300) return null;
            InputStream in = conn.getInputStream();
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) != -1) bos.write(buf, 0, n);
            in.close();
            return new String(bos.toByteArray(), "UTF-8");
        } catch (Throwable ignored) {
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static String normStr(String raw) {
        if (raw == null) return "";
        String nfd = Normalizer.normalize(raw.toLowerCase(Locale.ROOT), Normalizer.Form.NFD);
        return nfd.replaceAll("[\\\\p{InCombiningDiacriticalMarks}]", "")
                .replaceAll("[^a-z0-9\\\\s]", " ")
                .replaceAll("\\\\s+", " ")
                .trim();
    }
}
`,
  'utf-8'
);

// 6. Compile resources with aapt2 compile & link (WITHOUT -A so Windows aapt2 never emits '\' ZIP entries)
const compiledResZip = resolve(workDir, 'compiled_res.zip');
const unalignedApk = resolve(workDir, 'unaligned.apk');
const rJavaDir = resolve(workDir, 'r_java');
mkdirSync(rJavaDir, { recursive: true });

execFileSync(AAPT2, ['compile', '--dir', resDir, '-o', compiledResZip], { stdio: 'inherit' });
execFileSync(
  AAPT2,
  [
    'link',
    '-o',
    unalignedApk,
    '-I',
    PLATFORM_JAR,
    '--manifest',
    manifestPath,
    '--java',
    rJavaDir,
    compiledResZip,
  ],
  { stdio: 'inherit' }
);

// 7. Compile Java sources + generated R.java with javac -> classes.dex with d8
execFileSync(
  'javac',
  [
    '--release',
    '11',
    '-encoding',
    'UTF-8',
    '-classpath',
    PLATFORM_JAR,
    '-d',
    classesDir,
    resolve(rJavaDir, 'es/pmusic/app/R.java'),
    resolve(javaSrcDir, 'PMusicPlaybackService.java'),
    resolve(javaSrcDir, 'PMusicMediaBrowserService.java'),
    resolve(javaSrcDir, 'PMusicWidgetProvider.java'),
    resolve(javaSrcDir, 'PMusicCompactWidgetProvider.java'),
    resolve(javaSrcDir, 'PMusicRecentWidgetProvider.java'),
    resolve(javaSrcDir, 'PMusicCoverWidgetProvider.java'),
    resolve(javaSrcDir, 'PMusicReleaseCheckJobService.java'),
    resolve(javaSrcDir, 'PMusicApkProvider.java'),
    resolve(javaSrcDir, 'MainActivity.java'),
  ],
  { stdio: 'inherit' }
);

function collectClassFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectClassFiles(full));
    } else if (entry.name.endsWith('.class')) {
      out.push(full);
    }
  }
  return out;
}

const classFiles = collectClassFiles(classesDir);

execFileSync(
  'java',
  ['-cp', D8_JAR, 'com.android.tools.r8.D8', '--lib', PLATFORM_JAR, '--min-api', '24', '--output', dexDir, ...classFiles],
  { stdio: 'inherit' }
);

// 8. Add assets/ and classes.dex into unalignedApk via jar uMf (POSIX '/' paths, no premature META-INF)
execFileSync(
  'jar',
  ['uMf', unalignedApk, '-C', workDir, 'assets', '-C', dexDir, 'classes.dex'],
  { stdio: 'inherit' }
);

// 9. Zipalign to 4-byte boundaries
const alignedApk = resolve(workDir, 'aligned.apk');
execFileSync(ZIPALIGN, ['-f', '-p', '4', unalignedApk, alignedApk], { stdio: 'inherit' });

// 10. Reuse persistent debug keystore so future app upgrades preserve signing certificate
const keystoreDir = resolve(process.env.USERPROFILE || process.env.HOME || mobileRoot, '.android');
mkdirSync(keystoreDir, { recursive: true });
const keystorePath = resolve(keystoreDir, 'pmusic-release-debug.keystore');
if (!existsSync(keystorePath)) {
  execFileSync(
    'keytool',
    [
      '-genkeypair',
      '-v',
      '-keystore',
      keystorePath,
      '-storepass',
      'android',
      '-alias',
      'androiddebugkey',
      '-keypass',
      'android',
      '-keyalg',
      'RSA',
      '-keysize',
      '2048',
      '-validity',
      '10000',
      '-dname',
      'CN=pMusic Android,O=pMusic,C=ES',
    ],
    { stdio: 'ignore' }
  );
}

execFileSync(
  'java',
  [
    '-jar',
    APKSIGNER_JAR,
    'sign',
    '--ks',
    keystorePath,
    '--ks-pass',
    'pass:android',
    '--key-pass',
    'pass:android',
    '--ks-key-alias',
    'androiddebugkey',
    '--min-sdk-version',
    '24',
    '--v1-signing-enabled',
    'true',
    '--v2-signing-enabled',
    'true',
    '--v3-signing-enabled',
    'true',
    '--out',
    apkOutputPath,
    alignedApk,
  ],
  { stdio: 'inherit' }
);

function verifyApkZipStructure(apkFile) {
  const buf = readFileSync(apkFile);
  const localEntries = new Map();
  let offset = 0;
  while (offset + 30 <= buf.length && buf.readUInt32LE(offset) === 0x04034b50) {
    const compressionMethod = buf.readUInt16LE(offset + 8);
    const compressedSize = buf.readUInt32LE(offset + 18);
    const flags = buf.readUInt16LE(offset + 6);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const nameBytes = buf.subarray(offset + 30, offset + 30 + nameLen);
    const name = nameBytes.toString('utf8');
    if (name.includes('\\') || nameBytes.includes(0x5c) || name.startsWith('/') || name.includes('..')) {
      throw new Error(`Invalid ZIP local header entry name in APK: ${JSON.stringify(name)}`);
    }
    const dataOffset = offset + 30 + nameLen + extraLen;
    localEntries.set(name, { compressionMethod, dataOffset, compressedSize, flags });
    let nextOffset = dataOffset + compressedSize;
    if ((flags & 0x08) !== 0) {
      // Skip to data descriptor if bit 3 set
      const sigPos = buf.indexOf(Buffer.from([0x50, 0x4b, 0x07, 0x08]), nextOffset);
      if (sigPos >= 0) {
        nextOffset = sigPos + 16;
      } else {
        break;
      }
    }
    offset = nextOffset;
  }

  let eocdPos = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65558); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdPos = i;
      break;
    }
  }
  if (eocdPos < 0) {
    throw new Error('EOCD record not found in signed APK');
  }
  const cdOffset = buf.readUInt32LE(eocdPos + 16);
  const cdSize = buf.readUInt32LE(eocdPos + 12);
  let cdCursor = cdOffset;
  const cdEntries = new Map();
  while (cdCursor + 46 <= cdOffset + cdSize) {
    if (buf.readUInt32LE(cdCursor) !== 0x02014b50) {
      throw new Error(`Corrupt central directory signature at offset ${cdCursor}`);
    }
    const compressionMethod = buf.readUInt16LE(cdCursor + 10);
    const nameLen = buf.readUInt16LE(cdCursor + 28);
    const extraLen = buf.readUInt16LE(cdCursor + 30);
    const commentLen = buf.readUInt16LE(cdCursor + 32);
    const localHeaderRelOffset = buf.readUInt32LE(cdCursor + 42);
    const nameBytes = buf.subarray(cdCursor + 46, cdCursor + 46 + nameLen);
    const name = nameBytes.toString('utf8');
    if (name.includes('\\') || nameBytes.includes(0x5c) || name.startsWith('/') || name.includes('..')) {
      throw new Error(`Invalid central directory entry name in APK: ${JSON.stringify(name)}`);
    }
    const lhNameLen = buf.readUInt16LE(localHeaderRelOffset + 26);
    const lhExtraLen = buf.readUInt16LE(localHeaderRelOffset + 28);
    cdEntries.set(name, {
      compressionMethod,
      dataOffset: localHeaderRelOffset + 30 + lhNameLen + lhExtraLen,
    });
    cdCursor += 46 + nameLen + extraLen + commentLen;
  }

  for (const required of ['AndroidManifest.xml', 'resources.arsc', 'classes.dex', 'assets/public/index.html']) {
    if (!cdEntries.has(required)) {
      throw new Error(`Required APK entry missing: ${required}`);
    }
  }
  const arsc = cdEntries.get('resources.arsc');
  if (arsc.compressionMethod !== 0) {
    throw new Error(`resources.arsc must be STORED (method 0), got method ${arsc.compressionMethod}`);
  }
  if (arsc.dataOffset % 4 !== 0) {
    throw new Error(`resources.arsc data offset ${arsc.dataOffset} is not 4-byte aligned`);
  }
  console.log(`ZIP structural check passed: ${cdEntries.size} POSIX entries, 0 backslashes, resources.arsc STORED & 4-byte aligned @${arsc.dataOffset}`);
}

verifyApkZipStructure(apkOutputPath);
execFileSync(ZIPALIGN, ['-c', '-v', '4', apkOutputPath], { stdio: 'inherit' });
execFileSync('java', ['-jar', APKSIGNER_JAR, 'verify', '--verbose', '--min-sdk-version', '24', apkOutputPath], {
  stdio: 'inherit',
});
execFileSync('java', ['-jar', APKSIGNER_JAR, 'verify', '--verbose', '--min-sdk-version', '21', apkOutputPath], {
  stdio: 'inherit',
});
cpSync(apkOutputPath, apkNamedOutputPath);

const finalSize = statSync(apkOutputPath).size;
console.log(`Successfully compiled and cryptographically signed Android APK (${finalSize} bytes) at ${apkOutputPath} and ${apkNamedOutputPath}`);
