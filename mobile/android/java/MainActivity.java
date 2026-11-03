package org.example.jwnotes;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

/** Copied over the generated MainActivity by scripts/setup-android.cjs. */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // App-local plugins must be registered before the bridge starts.
        registerPlugin(GoogleDriveAuthPlugin.class);
        registerPlugin(SharedBackupPlugin.class);
        registerPlugin(JwLibraryAppPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
