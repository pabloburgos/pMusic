package es.pmusic.app;

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
