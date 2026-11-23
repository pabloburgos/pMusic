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
    android:versionCode="5"
    android:versionName="0.5.0">

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
import android.view.View;
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
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
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
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class MainActivity extends Activity {
    private static final String YT_IOS_UA = "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)";
    private static final String YT_WEB_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
    private static final long STREAM_CACHE_TTL_MS = 90L * 60L * 1000L;
    private static final Pattern YT_ID_PATTERN = Pattern.compile("^[a-zA-Z0-9_-]{11}$");
    private static final Pattern BAD_VERSION_PATTERN = Pattern.compile("(karaoke|remix|live|en vivo|cover|reaction|sped up|slowed|nightcore|instrumental|letra|lyrics|tutorial|8d audio|reverb)");
    private static final Pattern TITLE_NOISE_PATTERN = Pattern.compile("\\\\((?:feat\\\\.|ft\\\\.|with|prod\\\\.|official|video|audio|lyric|remix|en vivo|live).*?\\\\)|\\\\[(?:official|video|audio|lyric|remix|hd|4k).*?\\\\]", Pattern.CASE_INSENSITIVE);
    private static final Pattern DURATION_TOKEN_PATTERN = Pattern.compile("^\\\\d{1,2}:\\\\d{2}(?::\\\\d{2})?$");

    private static final class ResolvedStream {
        final String url;
        final String mime;
        final String userAgent;
        final long expiresAtMs;

        ResolvedStream(String url, String mime, String userAgent, long expiresAtMs) {
            this.url = url;
            this.mime = mime;
            this.userAgent = userAgent;
            this.expiresAtMs = expiresAtMs;
        }
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
    private byte[] syntheticWavBytes;
    private final Object streamCacheLock = new Object();
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

        Window window = getWindow();
        if (window != null && Build.VERSION.SDK_INT >= 21) {
            window.setStatusBarColor(Color.parseColor("#070709"));
            window.setNavigationBarColor(Color.parseColor("#070709"));
        }

        syntheticWavBytes = buildDeterministicWav(12, 120);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#070709"));
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);

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
                        String qTitle = uri.getQueryParameter("title");
                        String qArtist = uri.getQueryParameter("artist");
                        String qDurStr = uri.getQueryParameter("durationSec");
                        int qDurSec = 0;
                        if (qDurStr != null && !qDurStr.trim().isEmpty()) {
                            try {
                                qDurSec = Math.round(Float.parseFloat(qDurStr.trim()));
                            } catch (Exception ignored) {
                            }
                        }

                        String cacheKey = (rawTrackId != null ? rawTrackId : "") + "::" + (qTitle != null ? qTitle.trim() : "");
                        ResolvedStream fullStream = getOrResolveFullStream(cacheKey, rawTrackId, qTitle, qArtist, qDurSec);
                        if (fullStream != null) {
                            WebResourceResponse ytResp = proxyStreamResponse(
                                    fullStream,
                                    cacheKey,
                                    rawTrackId,
                                    qTitle,
                                    qArtist,
                                    qDurSec,
                                    corsHeaders,
                                    request.getRequestHeaders(),
                                    Build.VERSION.SDK_INT >= 21 ? request.getMethod() : "GET"
                            );
                            if (ytResp != null) return ytResp;
                        }

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

    private ResolvedStream getOrResolveFullStream(String cacheKey, String rawTrackId, String qTitle, String qArtist, int qDurationSec) {
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
            ResolvedStream resolved = resolveFullLengthStream(rawTrackId, qTitle, qArtist, qDurationSec);
            if (resolved != null) {
                synchronized (fullStreamCache) {
                    fullStreamCache.put(cacheKey, resolved);
                }
            }
            return resolved;
        }
    }

    private ResolvedStream resolveFullLengthStream(String rawTrackId, String qTitle, String qArtist, int qDurationSec) {
        try {
            if (rawTrackId != null && YT_ID_PATTERN.matcher(rawTrackId).matches()) {
                ResolvedStream direct = fetchYoutubeIosPlayerStream(rawTrackId);
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

            // 1) Primary: YouTube Music Songs search (WEB_REMIX)
            List<Candidate> ytmCandidates = searchYtMusicSongs(focusedQuery, strippedTitle, primaryArtist, targetDur);
            for (int i = 0; i < Math.min(3, ytmCandidates.size()); i++) {
                ResolvedStream rs = fetchYoutubeIosPlayerStream(ytmCandidates.get(i).videoId);
                if (rs != null) return rs;
            }

            // 2) Fallback: Standard YouTube search (WEB)
            List<Candidate> ytCandidates = searchStandardYoutube(focusedQuery + " audio", strippedTitle, primaryArtist, targetDur);
            for (int i = 0; i < Math.min(3, ytCandidates.size()); i++) {
                ResolvedStream rs = fetchYoutubeIosPlayerStream(ytCandidates.get(i).videoId);
                if (rs != null) return rs;
            }
        } catch (Exception ignored) {
        }
        return null;
    }

    private List<Candidate> searchYtMusicSongs(String query, String targetTitle, String targetArtist, int targetDurSec) {
        List<Candidate> results = new ArrayList<Candidate>();
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
                String subRaw = flex.length() > 1 ? extractFlexColumnText(flex.optJSONObject(1)) : "";
                int durSec = 0;
                StringBuilder subText = new StringBuilder();
                String[] segs = subRaw.split("\\\\s*[\\\\u2022\\\\u00b7|]\\\\s*");
                for (int s = 0; s < segs.length; s++) {
                    String part = segs[s].trim();
                    int parsed = parseDurationSec(part);
                    if (parsed > 0) {
                        durSec = parsed;
                    } else if (!part.isEmpty()) {
                        if (subText.length() > 0) subText.append(" ");
                        subText.append(part);
                    }
                }
                if (durSec == 0) {
                    JSONArray fixed = r.optJSONArray("fixedColumns");
                    if (fixed != null && fixed.length() > 0) {
                        durSec = parseDurationSec(extractFlexColumnText(fixed.optJSONObject(0)));
                    }
                }
                if (durSec < 40) continue;
                int score = scoreAudioCandidate(targetTitle, targetArtist, targetDurSec, candTitle, subText.toString(), durSec, true);
                if (score >= 6) {
                    results.add(new Candidate(vid, score));
                }
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
                }
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

    private ResolvedStream fetchYoutubeIosPlayerStream(String videoId) {
        try {
            JSONObject client = new JSONObject();
            client.put("clientName", "IOS");
            client.put("clientVersion", "20.10.4");
            client.put("deviceMake", "Apple");
            client.put("deviceModel", "iPhone16,2");
            client.put("osName", "iPhone");
            client.put("osVersion", "18.3.2.22D82");
            client.put("hl", "es");
            client.put("gl", "ES");
            JSONObject context = new JSONObject();
            context.put("client", client);
            JSONObject payload = new JSONObject();
            payload.put("videoId", videoId);
            payload.put("context", context);

            byte[] resp = postJsonBytes("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", YT_IOS_UA, "https://www.youtube.com", payload.toString());
            if (resp == null) return null;
            JSONObject root = new JSONObject(new String(resp, StandardCharsets.UTF_8));
            JSONObject statusObj = root.optJSONObject("playabilityStatus");
            if (statusObj == null || !"OK".equalsIgnoreCase(statusObj.optString("status", ""))) {
                return null;
            }
            JSONObject streamingData = root.optJSONObject("streamingData");
            if (streamingData == null) return null;

            String bestUrl = null;
            String bestMime = null;
            long bestScore = -1;

            JSONArray adaptive = streamingData.optJSONArray("adaptiveFormats");
            if (adaptive != null) {
                for (int i = 0; i < adaptive.length(); i++) {
                    JSONObject f = adaptive.optJSONObject(i);
                    if (f == null) continue;
                    String url = f.optString("url", "");
                    String mimeRaw = f.optString("mimeType", "").toLowerCase(Locale.ROOT);
                    if (!url.startsWith("http") || !mimeRaw.startsWith("audio/")) continue;
                    long tier = mimeRaw.contains("mp4") ? 2000000000L : 1000000000L;
                    long bitrate = f.optLong("bitrate", 0);
                    long sc = tier + bitrate;
                    if (sc > bestScore) {
                        bestScore = sc;
                        bestUrl = url;
                        bestMime = mimeRaw.split(";")[0].trim();
                    }
                }
            }

            if (bestUrl == null) {
                JSONArray progressive = streamingData.optJSONArray("formats");
                if (progressive != null) {
                    for (int i = 0; i < progressive.length(); i++) {
                        JSONObject f = progressive.optJSONObject(i);
                        if (f == null) continue;
                        String url = f.optString("url", "");
                        String mimeRaw = f.optString("mimeType", "").toLowerCase(Locale.ROOT);
                        if (!url.startsWith("http")) continue;
                        long tier = mimeRaw.contains("mp4") ? 500000000L : 100000000L;
                        long sc = tier + f.optLong("bitrate", 0);
                        if (sc > bestScore) {
                            bestScore = sc;
                            bestUrl = url;
                            bestMime = mimeRaw.isEmpty() ? "video/mp4" : mimeRaw.split(";")[0].trim();
                        }
                    }
                }
            }

            if (bestUrl != null) {
                return new ResolvedStream(bestUrl, bestMime != null ? bestMime : "audio/mp4", YT_IOS_UA, System.currentTimeMillis() + STREAM_CACHE_TTL_MS);
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
            Map<String, String> baseCorsHeaders,
            Map<String, String> reqHeaders,
            String method
    ) {
        String clientRange = getHeaderIgnoreCase(reqHeaders, "range");
        boolean hasClientRange = clientRange != null && !clientRange.trim().isEmpty();
        String rangeToSend = hasClientRange ? clientRange.trim() : "bytes=0-";
        boolean isHead = "HEAD".equalsIgnoreCase(method);

        ResolvedStream active = stream;
        for (int attempt = 0; attempt < 2; attempt++) {
            HttpURLConnection conn = null;
            try {
                URL url = new URL(active.url);
                conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod(isHead ? "HEAD" : "GET");
                conn.setConnectTimeout(10000);
                conn.setReadTimeout(25000);
                conn.setInstanceFollowRedirects(true);
                conn.setRequestProperty("User-Agent", active.userAgent);
                conn.setRequestProperty("Range", rangeToSend);
                conn.setRequestProperty("Accept", "*/*");
                conn.setRequestProperty("Connection", "close");

                int code = conn.getResponseCode();
                if (code == 200 || code == 206) {
                    Map<String, String> respHeaders = new HashMap<String, String>(baseCorsHeaders);
                    respHeaders.put("Accept-Ranges", "bytes");
                    respHeaders.put("Cache-Control", "no-cache");
                    respHeaders.put("X-PMusic-Stream-Source", "youtube-full-android");

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
                    ResolvedStream refreshed = getOrResolveFullStream(cacheKey, rawTrackId, qTitle, qArtist, qDurSec);
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
                    ResolvedStream refreshed = getOrResolveFullStream(cacheKey, rawTrackId, qTitle, qArtist, qDurSec);
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
        if (BAD_VERSION_PATTERN.matcher(candNorm).find() && !BAD_VERSION_PATTERN.matcher(rawNormTitle).find()) {
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
        if (artistHit) {
            score += 6;
        } else if (!aTokens.isEmpty()) {
            score -= 6;
        }

        int diff = Math.abs(candDurSec - targetDurSec);
        if (diff <= 8) score += 6;
        else if (diff <= 18) score += 3;
        else if (diff > 45) score -= 6;

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
            conn.setConnectTimeout(4500);
            conn.setReadTimeout(6500);
            conn.setInstanceFollowRedirects(true);
            conn.setRequestProperty("User-Agent", "pMusic-Android/0.5.0");
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
    '-encoding',
    'UTF-8',
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
