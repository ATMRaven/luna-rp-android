package com.atmr.lunarp;

import android.os.Bundle;
import com.atmr.lunarp.plugins.apkinstaller.ApkInstallerPlugin;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ApkInstallerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
