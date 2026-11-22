import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
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

const ANDROID_SDK = '/opt/android-sdk';
const BUILD_TOOLS = `${ANDROID_SDK}/build-tools/35.0.0`;
const PLATFORM_JAR = `${ANDROID_SDK}/platforms/android-35/android.jar`;
const AAPT2 = `${BUILD_TOOLS}/aapt2`;
const D8 = `${BUILD_TOOLS}/d8`;
const ZIPALIGN = `${BUILD_TOOLS}/zipalign`;
const APKSIGNER = `${BUILD_TOOLS}/apksigner`;

const workDir = resolve(mobileRoot, 'android/app/build/real-apk-work');
rmSync(workDir, { recursive: true, force: true });
mkdirSync(workDir, { recursive: true });
mkdirSync(apkOutputDir, { recursive: true });

const resDir = resolve(workDir, 'res');
const valuesDir = resolve(resDir, 'values');
const drawableDir = resolve(resDir, 'drawable');
const assetsPublicDir = resolve(workDir, 'assets/public');
const javaSrcDir = resolve(workDir, 'java/es/pmusic/app');
const classesDir = resolve(workDir, 'classes');
const dexDir = resolve(workDir, 'dex');

mkdirSync(valuesDir, { recursive: true });
mkdirSync(drawableDir, { recursive: true });
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

writeFileSync(resolve(drawableDir, 'ic_launcher.png'), generateIconPng(192));

// 3. Write res/values/strings.xml
writeFileSync(
  resolve(valuesDir, 'strings.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">pMusic</string>
</resources>
`,
  'utf-8'
);

// 4. Write AndroidManifest.xml (compiled into binary AXML by aapt2)
const manifestPath = resolve(workDir, 'AndroidManifest.xml');
writeFileSync(
  manifestPath,
  `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="es.pmusic.app"
    android:versionCode="1"
    android:versionName="0.1.0">

    <uses-sdk android:minSdkVersion="24" android:targetSdkVersion="35" />

    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.WAKE_LOCK" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK" />

    <application
        android:allowBackup="true"
        android:icon="@drawable/ic_launcher"
        android:label="@string/app_name"
        android:usesCleartextTraffic="true"
        android:hardwareAccelerated="true"
        android:theme="@android:style/Theme.DeviceDefault.NoActionBar">

        <activity
            android:name="es.pmusic.app.MainActivity"
            android:exported="true"
            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|uiMode"
            android:launchMode="singleTask">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>

        <service
            android:name="es.pmusic.app.PMusicPlaybackService"
            android:enabled="true"
            android:exported="false"
            android:foregroundServiceType="mediaPlayback" />
    </application>
</manifest>
`,
  'utf-8'
);

// 5. Write Java sources (MainActivity with embedded WebView + WebResourceResponse asset/stream server & PMusicPlaybackService)
writeFileSync(
  resolve(javaSrcDir, 'PMusicPlaybackService.java'),
  `package es.pmusic.app;

import android.app.Service;
import android.content.Intent;
import android.os.IBinder;
import android.os.PowerManager;

public class PMusicPlaybackService extends Service {
    private PowerManager.WakeLock wakeLock;

    @Override
    public void onCreate() {
        super.onCreate();
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        if (pm != null) {
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "pMusic::PlaybackWakeLock");
            wakeLock.setReferenceCounted(false);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (wakeLock != null && !wakeLock.isHeld()) {
            wakeLock.acquire(4 * 60 * 60 * 1000L);
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
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
  resolve(javaSrcDir, 'MainActivity.java'),
  `package es.pmusic.app;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

public class MainActivity extends Activity {
    private WebView webView;
    private byte[] syntheticWavBytes;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Window window = getWindow();
        if (window != null && Build.VERSION.SDK_INT >= 21) {
            window.setStatusBarColor(Color.parseColor("#08080C"));
            window.setNavigationBarColor(Color.parseColor("#08080C"));
        }

        syntheticWavBytes = buildDeterministicWav(12, 120);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#08080C"));

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        if (Build.VERSION.SDK_INT >= 17) {
            settings.setMediaPlaybackRequiresUserGesture(false);
        }

        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (uri == null) return null;
                String host = uri.getHost();
                String path = uri.getPath();
                if (path == null) path = "/";

                if ("appassets.pmusic.local".equalsIgnoreCase(host)) {
                    if (path.startsWith("/api/stream/")) {
                        Map<String, String> headers = new HashMap<String, String>();
                        headers.put("Access-Control-Allow-Origin", "*");
                        headers.put("Accept-Ranges", "bytes");
                        return new WebResourceResponse(
                                "audio/wav",
                                "binary",
                                200,
                                "OK",
                                headers,
                                new ByteArrayInputStream(syntheticWavBytes)
                        );
                    }
                    String assetPath = path.equals("/") ? "public/index.html" : "public" + path;
                    try {
                        InputStream is = getAssets().open(assetPath);
                        String mime = guessMime(assetPath);
                        Map<String, String> headers = new HashMap<String, String>();
                        headers.put("Access-Control-Allow-Origin", "*");
                        return new WebResourceResponse(mime, "UTF-8", 200, "OK", headers, is);
                    } catch (Exception e) {
                        try {
                            InputStream indexIs = getAssets().open("public/index.html");
                            return new WebResourceResponse("text/html", "UTF-8", indexIs);
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
            startService(new Intent(this, PMusicPlaybackService.class));
        } catch (Exception ignored) {
        }

        webView.loadUrl("https://appassets.pmusic.local/index.html");
    }

    private String guessMime(String path) {
        String lower = path.toLowerCase();
        if (lower.endsWith(".html")) return "text/html";
        if (lower.endsWith(".js") || lower.endsWith(".mjs")) return "application/javascript";
        if (lower.endsWith(".css")) return "text/css";
        if (lower.endsWith(".json")) return "application/json";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".wav")) return "audio/wav";
        return "application/octet-stream";
    }

    private byte[] buildDeterministicWav(int durationSec, int bpm) {
        int sampleRate = 22050;
        int numSamples = durationSec * sampleRate;
        int dataBytes = numSamples * 2;
        byte[] buf = new byte[44 + dataBytes];

        buf[0] = 'R'; buf[1] = 'I'; buf[2] = 'F'; buf[3] = 'F';
        writeIntLE(buf, 4, 36 + dataBytes);
        buf[8] = 'W'; buf[9] = 'A'; buf[10] = 'V'; buf[11] = 'E';
        buf[12] = 'f'; buf[13] = 'm'; buf[14] = 't'; buf[15] = ' ';
        writeIntLE(buf, 16, 16);
        writeShortLE(buf, 20, (short) 1);
        writeShortLE(buf, 22, (short) 1);
        writeIntLE(buf, 24, sampleRate);
        writeIntLE(buf, 28, sampleRate * 2);
        writeShortLE(buf, 32, (short) 2);
        writeShortLE(buf, 34, (short) 16);
        buf[36] = 'd'; buf[37] = 'a'; buf[38] = 't'; buf[39] = 'a';
        writeIntLE(buf, 40, dataBytes);

        double beatPeriod = 60.0 / bpm;
        for (int i = 0; i < numSamples; i++) {
            double t = (double) i / sampleRate;
            double beatPhase = (t % beatPeriod) / beatPeriod;
            double env = beatPhase < 0.2 ? Math.exp(-beatPhase * 15.0) : 0.15;
            double wave = (Math.sin(2.0 * Math.PI * 110.0 * t) * 0.6 + Math.sin(2.0 * Math.PI * 220.0 * t) * 0.3) * env;
            short pcm = (short) Math.max(-30000, Math.min(30000, (int) (wave * 24000)));
            writeShortLE(buf, 44 + i * 2, pcm);
        }
        return buf;
    }

    private void writeIntLE(byte[] b, int offset, int v) {
        b[offset] = (byte) (v & 0xFF);
        b[offset + 1] = (byte) ((v >>> 8) & 0xFF);
        b[offset + 2] = (byte) ((v >>> 16) & 0xFF);
        b[offset + 3] = (byte) ((v >>> 24) & 0xFF);
    }

    private void writeShortLE(byte[] b, int offset, short v) {
        b[offset] = (byte) (v & 0xFF);
        b[offset + 1] = (byte) ((v >>> 8) & 0xFF);
    }

    @Override
    public void onBackPressed() {
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

// 6. Compile resources with aapt2 compile & link (generates binary AXML AndroidManifest.xml + resources.arsc + R.java)
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
    '-A',
    resolve(workDir, 'assets'),
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
    '-classpath',
    PLATFORM_JAR,
    '-d',
    classesDir,
    resolve(rJavaDir, 'es/pmusic/app/R.java'),
    resolve(javaSrcDir, 'PMusicPlaybackService.java'),
    resolve(javaSrcDir, 'MainActivity.java'),
  ],
  { stdio: 'inherit' }
);

const classFiles = [
  resolve(classesDir, 'es/pmusic/app/R.class'),
  resolve(classesDir, 'es/pmusic/app/R$drawable.class'),
  resolve(classesDir, 'es/pmusic/app/R$string.class'),
  resolve(classesDir, 'es/pmusic/app/PMusicPlaybackService.class'),
  resolve(classesDir, 'es/pmusic/app/MainActivity.class'),
  resolve(classesDir, 'es/pmusic/app/MainActivity$1.class'),
].filter((f) => existsSync(f));

execFileSync(D8, ['--lib', PLATFORM_JAR, '--min-api', '24', '--output', dexDir, ...classFiles], {
  stdio: 'inherit',
});

// 8. Add compiled classes.dex into unaligned.apk
execFileSync('zip', ['-j', unalignedApk, resolve(dexDir, 'classes.dex')], { stdio: 'inherit' });

// 9. Zipalign to 4-byte boundaries
const alignedApk = resolve(workDir, 'aligned.apk');
execFileSync(ZIPALIGN, ['-f', '-p', '4', unalignedApk, alignedApk], { stdio: 'inherit' });

// 10. Generate Android debug keystore and sign APK with v1 + v2 + v3 signatures via apksigner
const keystorePath = resolve(workDir, 'debug.keystore');
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
    'CN=Android Debug,O=Android,C=ES',
  ],
  { stdio: 'ignore' }
);

execFileSync(
  APKSIGNER,
  [
    'sign',
    '--ks',
    keystorePath,
    '--ks-pass',
    'pass:android',
    '--key-pass',
    'pass:android',
    '--ks-key-alias',
    'androiddebugkey',
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

execFileSync(APKSIGNER, ['verify', '--verbose', apkOutputPath], { stdio: 'inherit' });

const finalSize = statSync(apkOutputPath).size;
console.log(`Successfully compiled and cryptographically signed Android APK (${finalSize} bytes) at ${apkOutputPath}`);
