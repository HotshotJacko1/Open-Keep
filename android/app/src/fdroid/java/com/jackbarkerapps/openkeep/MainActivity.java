package com.jackbarkerapps.openkeep;

import com.getcapacitor.BridgeActivity;

// F-Droid flavor: no @capgo/capacitor-social-login (Google/Facebook sign-in),
// so none of the Google activity-result plumbing in src/play/.../MainActivity.java.
// Keep onCreate in sync with that file.
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(NoteStoragePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
