package com.aybad.paraph;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(IncomingFilePlugin.class);
        registerPlugin(SaveAsPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        IncomingFilePlugin.pending = intent;
        if (getBridge() != null) {
            PluginHandle handle = getBridge().getPlugin("IncomingFile");
            if (handle != null && handle.getInstance() instanceof IncomingFilePlugin) {
                ((IncomingFilePlugin) handle.getInstance()).notifyIncoming();
            }
        }
    }
}
