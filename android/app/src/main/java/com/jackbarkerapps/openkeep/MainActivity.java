package com.jackbarkerapps.openkeep;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(NoteStoragePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
