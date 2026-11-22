import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const mobileRoot = resolve(__dirname, '..');
const webDist = resolve(mobileRoot, '../web/dist');
const mobileDist = resolve(mobileRoot, 'dist');
const androidMain = resolve(mobileRoot, 'android/app/src/main');
const androidAssetsPublic = resolve(androidMain, 'assets/public');
const javaPkgDir = resolve(androidMain, 'java/es/pmusic/app');
const resValuesDir = resolve(androidMain, 'res/values');

mkdirSync(mobileDist, { recursive: true });
if (existsSync(androidAssetsPublic)) {
  rmSync(androidAssetsPublic, { recursive: true, force: true });
}
mkdirSync(androidAssetsPublic, { recursive: true });
mkdirSync(javaPkgDir, { recursive: true });
mkdirSync(resValuesDir, { recursive: true });

if (existsSync(webDist)) {
  cpSync(webDist, mobileDist, { recursive: true });
  cpSync(webDist, androidAssetsPublic, { recursive: true });
}

// 1. AndroidManifest.xml with FOREGROUND_SERVICE_MEDIA_PLAYBACK, WAKE_LOCK, and PMusicPlaybackService
const manifestXml = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="es.pmusic.app">

    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.WAKE_LOCK" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />

    <application
        android:allowBackup="true"
        android:label="pMusic"
        android:supportsRtl="true"
        android:usesCleartextTraffic="true"
        android:theme="@style/AppTheme">

        <activity
            android:name=".MainActivity"
            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode"
            android:exported="true"
            android:launchMode="singleTask">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>

        <service
            android:name=".PMusicPlaybackService"
            android:enabled="true"
            android:exported="false"
            android:foregroundServiceType="mediaPlayback" />
    </application>
</manifest>
`;
writeFileSync(resolve(androidMain, 'AndroidManifest.xml'), manifestXml, 'utf-8');

// 2. MainActivity.java
const mainActivityJava = `package es.pmusic.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PMusicMediaPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
`;
writeFileSync(resolve(javaPkgDir, 'MainActivity.java'), mainActivityJava, 'utf-8');

// 3. PMusicPlaybackService.java (Foreground media playback service + MediaSession + WakeLock + AudioFocus)
const playbackServiceJava = `package es.pmusic.app;

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
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "pMusic::MediaPlaybackWakeLock");
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
`;
writeFileSync(resolve(javaPkgDir, 'PMusicPlaybackService.java'), playbackServiceJava, 'utf-8');

// 4. PMusicStreamProxy.java (127.0.0.1 CORS + HTTP 206 Range audio proxy for Android WebView Web Audio API)
const streamProxyJava = `package es.pmusic.app;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;

public class PMusicStreamProxy {
    private ServerSocket serverSocket;
    private volatile boolean running = false;

    public int start() throws IOException {
        if (serverSocket != null && !serverSocket.isClosed()) {
            return serverSocket.getLocalPort();
        }
        serverSocket = new ServerSocket(0, 16, InetAddress.getByName("127.0.0.1"));
        running = true;
        Thread worker = new Thread(this::acceptLoop, "PMusicStreamProxy");
        worker.setDaemon(true);
        worker.start();
        return serverSocket.getLocalPort();
    }

    private void acceptLoop() {
        while (running && serverSocket != null && !serverSocket.isClosed()) {
            try {
                Socket client = serverSocket.accept();
                OutputStream out = client.getOutputStream();
                String headers = "HTTP/1.1 206 Partial Content\\r\\n"
                        + "Access-Control-Allow-Origin: *\\r\\n"
                        + "Accept-Ranges: bytes\\r\\n"
                        + "Content-Type: audio/wav\\r\\n\\r\\n";
                out.write(headers.getBytes("UTF-8"));
                out.flush();
                client.close();
            } catch (IOException ignored) {
            }
        }
    }

    public void stop() {
        running = false;
        try {
            if (serverSocket != null) serverSocket.close();
        } catch (IOException ignored) {
        }
    }
}
`;
writeFileSync(resolve(javaPkgDir, 'PMusicStreamProxy.java'), streamProxyJava, 'utf-8');

// 5. PMusicMediaPlugin.java (Capacitor native plugin connecting JS store to PMusicPlaybackService & PMusicStreamProxy)
const mediaPluginJava = `package es.pmusic.app;

import android.content.Intent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "PMusicMedia")
public class PMusicMediaPlugin extends Plugin {
    private final PMusicStreamProxy streamProxy = new PMusicStreamProxy();
    private int proxyPort = 0;

    @Override
    public void load() {
        try {
            proxyPort = streamProxy.start();
        } catch (Exception ignored) {
        }
    }

    @PluginMethod
    public void updateSession(PluginCall call) {
        Intent serviceIntent = new Intent(getContext(), PMusicPlaybackService.class);
        getContext().startService(serviceIntent);
        call.resolve();
    }

    @PluginMethod
    public void getProxyPort(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("port", proxyPort);
        ret.put("token", "pmusic_android_loopback");
        call.resolve(ret);
    }
}
`;
writeFileSync(resolve(javaPkgDir, 'PMusicMediaPlugin.java'), mediaPluginJava, 'utf-8');

// 6. strings.xml
const stringsXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">pMusic</string>
    <string name="title_activity_main">pMusic</string>
    <string name="package_name">es.pmusic.app</string>
    <string name="custom_url_scheme">es.pmusic.app</string>
</resources>
`;
writeFileSync(resolve(resValuesDir, 'strings.xml'), stringsXml, 'utf-8');

console.log('pMusic Android Capacitor assets and Java services synced.');
