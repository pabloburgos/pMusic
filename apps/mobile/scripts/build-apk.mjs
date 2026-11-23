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
    android:versionCode="4"
    android:versionName="0.4.0">

    <uses-sdk android:minSdkVersion="24" android:targetSdkVersion="34" />

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
import android.view.Window;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;

public class MainActivity extends Activity {
    private WebView webView;
    private byte[] syntheticWavBytes;
    private final Object streamCacheLock = new Object();
    private String lastStreamId;
    private byte[] lastStreamBytes;
    private String lastStreamMime;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Window window = getWindow();
        if (window != null && Build.VERSION.SDK_INT >= 21) {
            window.setStatusBarColor(Color.parseColor("#070709"));
            window.setNavigationBarColor(Color.parseColor("#070709"));
        }

        syntheticWavBytes = buildDeterministicWav(12, 120);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#070709"));

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        if (Build.VERSION.SDK_INT >= 17) {
            settings.setMediaPlaybackRequiresUserGesture(false);
        }
        if (Build.VERSION.SDK_INT >= 21) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
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
                    Map<String, String> corsHeaders = new HashMap<String, String>();
                    corsHeaders.put("Access-Control-Allow-Origin", "*");
                    corsHeaders.put("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
                    corsHeaders.put("Access-Control-Allow-Headers", "Range, Content-Type, Accept");
                    corsHeaders.put("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges");

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

                    if (path.startsWith("/api/stream/")) {
                        String rawTrackId = Uri.decode(path.substring("/api/stream/".length()));
                        byte[] audioBytes = null;
                        String audioMime = "audio/wav";

                        if (rawTrackId != null) {
                            synchronized (streamCacheLock) {
                                if (rawTrackId.equals(lastStreamId) && lastStreamBytes != null) {
                                    audioBytes = lastStreamBytes;
                                    audioMime = lastStreamMime != null ? lastStreamMime : "audio/mpeg";
                                }
                            }
                        }

                        if (audioBytes == null && rawTrackId != null && rawTrackId.startsWith("dz:")) {
                            String dzId = rawTrackId.substring(3);
                            try {
                                byte[] metaBytes = fetchRemoteBytes("https://api.deezer.com/track/" + dzId);
                                if (metaBytes != null) {
                                    JSONObject obj = new JSONObject(new String(metaBytes, StandardCharsets.UTF_8));
                                    String previewUrl = obj.optString("preview", "");
                                    if (previewUrl != null && previewUrl.startsWith("http")) {
                                        byte[] mp3Bytes = fetchRemoteBytes(previewUrl);
                                        if (mp3Bytes != null && mp3Bytes.length > 1024) {
                                            audioBytes = mp3Bytes;
                                            audioMime = "audio/mpeg";
                                            synchronized (streamCacheLock) {
                                                lastStreamId = rawTrackId;
                                                lastStreamBytes = mp3Bytes;
                                                lastStreamMime = "audio/mpeg";
                                            }
                                        }
                                    }
                                }
                            } catch (Exception ignored) {
                            }
                        }

                        if (audioBytes == null) {
                            String qTitle = uri.getQueryParameter("title");
                            String qArtist = uri.getQueryParameter("artist");
                            if (qTitle != null && !qTitle.trim().isEmpty()) {
                                try {
                                    String rawQuery = (qArtist != null && !qArtist.trim().isEmpty() ? qArtist.trim() + " " : "") + qTitle.trim();
                                    String encodedQ = URLEncoder.encode(rawQuery, "UTF-8");
                                    byte[] searchBytes = fetchRemoteBytes("https://api.deezer.com/search?q=" + encodedQ + "&limit=1");
                                    if (searchBytes != null) {
                                        JSONObject sObj = new JSONObject(new String(searchBytes, StandardCharsets.UTF_8));
                                        JSONArray dataArr = sObj.optJSONArray("data");
                                        if (dataArr != null && dataArr.length() > 0) {
                                            String previewUrl = dataArr.getJSONObject(0).optString("preview", "");
                                            if (previewUrl != null && previewUrl.startsWith("http")) {
                                                byte[] mp3Bytes = fetchRemoteBytes(previewUrl);
                                                if (mp3Bytes != null && mp3Bytes.length > 1024) {
                                                    audioBytes = mp3Bytes;
                                                    audioMime = "audio/mpeg";
                                                    if (rawTrackId != null) {
                                                        synchronized (streamCacheLock) {
                                                            lastStreamId = rawTrackId;
                                                            lastStreamBytes = mp3Bytes;
                                                            lastStreamMime = "audio/mpeg";
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                } catch (Exception ignored) {
                                }
                            }
                        }

                        if (audioBytes == null) {
                            audioBytes = syntheticWavBytes;
                            audioMime = "audio/wav";
                        }

                        return buildAudioStreamResponse(audioBytes, audioMime, corsHeaders, request.getRequestHeaders());
                    }

                    if (path.startsWith("/api/")) {
                        byte[] notFound = "{\\"error\\":\\"offline\\"}".getBytes(StandardCharsets.UTF_8);
                        return new WebResourceResponse("application/json", "UTF-8", 404, "Not Found", corsHeaders, new ByteArrayInputStream(notFound));
                    }

                    String cleanPath = path.split("[?#]", 2)[0];
                    String assetPath = cleanPath.equals("/") ? "public/index.html" : "public" + cleanPath;
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
            startService(new Intent(this, PMusicPlaybackService.class));
        } catch (Exception ignored) {
        }

        webView.loadUrl("https://appassets.pmusic.local/index.html");
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
            conn.setConnectTimeout(4500);
            conn.setReadTimeout(6500);
            conn.setInstanceFollowRedirects(true);
            conn.setRequestProperty("User-Agent", "pMusic-Android/0.4.0");
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
