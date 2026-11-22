package es.pmusic.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PMusicMediaPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
