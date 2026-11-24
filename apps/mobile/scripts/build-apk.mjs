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

const androidBrandIcon = resolve(__dirname, '../../desktop/build/icon-android.png');
if (existsSync(androidBrandIcon)) {
  cpSync(androidBrandIcon, resolve(drawableDir, 'ic_launcher.png'));
} else {
  writeFileSync(resolve(drawableDir, 'ic_launcher.png'), generateIconPng(192));
}

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
    android:versionCode="21"
    android:versionName="0.15.0">

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
    </application>
</manifest>
`,
  'utf-8'
);

// 5. Write Java sources (MainActivity with embedded WebView + WebResourceResponse asset/stream server & PMusicPlaybackService)
writeFileSync(
  resolve(javaSrcDir, 'PMusicPlaybackService.java'),
  `package es.pmusic.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

public class PMusicPlaybackService extends Service {
    private static final String CHANNEL_ID = "pmusic_playback_channel";
    private static final int NOTIFICATION_ID = 1001;
    private PowerManager.WakeLock wakeLock;

    private void ensureForegroundNotification() {
        try {
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
                nm.createNotificationChannel(ch);
            }

            Intent launchIntent = new Intent(this, MainActivity.class);
            launchIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            int piFlags = Build.VERSION.SDK_INT >= 23
                    ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                    : PendingIntent.FLAG_UPDATE_CURRENT;
            PendingIntent pi = PendingIntent.getActivity(this, 0, launchIntent, piFlags);

            Notification.Builder builder = Build.VERSION.SDK_INT >= 26
                    ? new Notification.Builder(this, CHANNEL_ID)
                    : new Notification.Builder(this);
            Notification notif = builder
                    .setContentTitle("pMusic")
                    .setContentText("Reproducci\\u00f3n de audio activa")
                    .setSmallIcon(android.R.drawable.ic_media_play)
                    .setContentIntent(pi)
                    .setOngoing(true)
                    .build();
            startForeground(NOTIFICATION_ID, notif);
        } catch (Throwable ignored) {
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        if (pm != null) {
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "pMusic::PlaybackWakeLock");
            wakeLock.setReferenceCounted(false);
        }
        ensureForegroundNotification();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        ensureForegroundNotification();
        if (wakeLock != null && !wakeLock.isHeld()) {
            wakeLock.acquire(4 * 60 * 60 * 1000L);
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        try {
            stopForeground(true);
        } catch (Throwable ignored) {
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
    private static final long STREAM_CACHE_TTL_MS = 35L * 60L * 1000L;
    private static final Pattern YT_ID_PATTERN = Pattern.compile("^[a-zA-Z0-9_-]{11}$");
    private static final Pattern BAD_VERSION_PATTERN = Pattern.compile("\\\\b(karaoke|remix|rmx|mashup|bootleg|flip|rework|refix|vip mix|club mix|extended mix|break intro|dj intro|intro edit|acapella|a capella|live|en vivo|cover|reaction|sped up|slowed|nightcore|instrumental|letra|lyrics|tutorial|8d audio|reverb|bass boosted|dj set|mixtape|megamix|tribute|parodia|parody|ai cover|pitched|radio edit|edit|version)\\\\b");
    private static final Pattern TITLE_NOISE_PATTERN = Pattern.compile("\\\\((?:feat\\\\.|ft\\\\.|with|prod\\\\.|official|video|audio|lyric|remix|en vivo|live).*?\\\\)|\\\\[(?:official|video|audio|lyric|remix|hd|4k).*?\\\\]", Pattern.CASE_INSENSITIVE);
    private static final Pattern DURATION_TOKEN_PATTERN = Pattern.compile("^\\\\d{1,2}:\\\\d{2}(?::\\\\d{2})?$");
    private static final Pattern OPEN_RANGE_PATTERN = Pattern.compile("^bytes=(\\\\d+)-$");

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
    private String pendingAuthCallbackUrl = null;
    private int safeInsetTopDp = 0;
    private int safeInsetBottomDp = 0;
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
            window.setBackgroundDrawable(new android.graphics.drawable.ColorDrawable(Color.parseColor("#070709")));
        }
        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#070709"));
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
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

                        byte[] unavail = "{\\"error\\":\\"stream_unavailable\\"}".getBytes(StandardCharsets.UTF_8);
                        return new WebResourceResponse("application/json", "UTF-8", 503, "Service Unavailable", corsHeaders, new ByteArrayInputStream(unavail));
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
            Intent serviceIntent = new Intent(this, PMusicPlaybackService.class);
            if (Build.VERSION.SDK_INT >= 26) {
                startForegroundService(serviceIntent);
            } else {
                startService(serviceIntent);
            }
        } catch (Exception ignored) {
        }

        handleDeepLinkIntent(getIntent());
        webView.loadUrl("https://appassets.pmusic.local/index.html");
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleDeepLinkIntent(intent);
    }

    private void handleDeepLinkIntent(Intent intent) {
        if (intent == null) return;
        Uri data = intent.getData();
        if (data != null && "pmusic".equalsIgnoreCase(data.getScheme())) {
            String fullUrl = data.toString();
            pendingAuthCallbackUrl = fullUrl;
            dispatchAuthCallbackToJs(fullUrl);
        }
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
            boolean ytAllowed = System.currentTimeMillis() >= ytBotCooldownUntilMs;
            if (ytAllowed && rawTrackId != null && YT_ID_PATTERN.matcher(rawTrackId).matches()) {
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

            if (System.currentTimeMillis() >= ytBotCooldownUntilMs) {
                // 1) Primary: YouTube Music Songs search (WEB_REMIX)
                List<Candidate> ytmCandidates = searchYtMusicSongs(focusedQuery, strippedTitle, primaryArtist, targetDur);
                for (int i = 0; i < Math.min(3, ytmCandidates.size()); i++) {
                    if (System.currentTimeMillis() < ytBotCooldownUntilMs) break;
                    ResolvedStream rs = fetchYoutubeIosPlayerStream(ytmCandidates.get(i).videoId);
                    if (rs != null) return rs;
                }

                // 2) Fallback: Standard YouTube search (WEB)
                if (System.currentTimeMillis() >= ytBotCooldownUntilMs) {
                    List<Candidate> ytCandidates = searchStandardYoutube(focusedQuery + " audio", strippedTitle, primaryArtist, targetDur);
                    for (int i = 0; i < Math.min(3, ytCandidates.size()); i++) {
                        if (System.currentTimeMillis() < ytBotCooldownUntilMs) break;
                        ResolvedStream rs = fetchYoutubeIosPlayerStream(ytCandidates.get(i).videoId);
                        if (rs != null) return rs;
                    }
                }
                if (System.currentTimeMillis() >= ytBotCooldownUntilMs) {
                    List<Candidate> ytDirectCandidates = searchStandardYoutube(focusedQuery, strippedTitle, primaryArtist, targetDur);
                    for (int i = 0; i < Math.min(3, ytDirectCandidates.size()); i++) {
                        if (System.currentTimeMillis() < ytBotCooldownUntilMs) break;
                        ResolvedStream rs = fetchYoutubeIosPlayerStream(ytDirectCandidates.get(i).videoId);
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
            boolean wantsSpecial = BAD_VERSION_PATTERN.matcher(normText(targetTitle)).find();

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
                    if (!wantsSpecial && BAD_VERSION_PATTERN.matcher(normText(candTitle + " " + candArtist)).find()) {
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
                        System.currentTimeMillis() + STREAM_CACHE_TTL_MS
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

    private ResolvedStream fetchYoutubeIosPlayerStream(String videoId) {
        int[] botRejects = new int[] { 0 };
        String[] modes = new String[] { "ANDROID_VR", "TV_EMBED", "IOS", "ANDROID", "MWEB" };
        for (int i = 0; i < modes.length; i++) {
            ResolvedStream stream = fetchYoutubeClientPlayerStream(videoId, modes[i], botRejects);
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

    private ResolvedStream fetchYoutubeClientPlayerStream(String videoId, String clientMode, int[] botRejects) {
        try {
            JSONObject client = new JSONObject();
            JSONObject thirdParty = null;
            String ua;
            if ("ANDROID_VR".equals(clientMode)) {
                client.put("clientName", "ANDROID_VR");
                client.put("clientVersion", "1.60.19");
                client.put("deviceMake", "Oculus");
                client.put("deviceModel", "Quest 3");
                client.put("osName", "Android");
                client.put("osVersion", "12L");
                client.put("androidSdkVersion", 32);
                ua = "com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip";
            } else if ("TV_EMBED".equals(clientMode)) {
                client.put("clientName", "TVHTML5_SIMPLY_EMBEDDED_PLAYER");
                client.put("clientVersion", "2.0");
                thirdParty = new JSONObject();
                thirdParty.put("embedUrl", "https://www.youtube.com");
                ua = YT_WEB_UA;
            } else if ("IOS".equals(clientMode)) {
                client.put("clientName", "IOS");
                client.put("clientVersion", "20.10.4");
                client.put("deviceMake", "Apple");
                client.put("deviceModel", "iPhone16,2");
                client.put("osName", "iPhone");
                client.put("osVersion", "18.3.2.22D82");
                ua = YT_IOS_UA;
            } else if ("ANDROID".equals(clientMode)) {
                client.put("clientName", "ANDROID");
                client.put("clientVersion", "20.10.38");
                client.put("androidSdkVersion", 34);
                ua = "com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip";
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
                return new ResolvedStream(bestUrl, bestMime != null ? bestMime : "audio/mp4", ua, System.currentTimeMillis() + STREAM_CACHE_TTL_MS);
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
        if (hasClientRange) {
            Matcher om = OPEN_RANGE_PATTERN.matcher(rangeToSend);
            if (om.matches()) {
                try {
                    long startByte = Long.parseLong(om.group(1));
                    long endByte = startByte + 1572863L;
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
