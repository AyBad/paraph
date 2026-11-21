package com.aybad.paraph;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.OutputStream;

/** "Save as…": the system file picker lets the user choose where to store the file on the phone. */
@CapacitorPlugin(name = "SaveAs")
public class SaveAsPlugin extends Plugin {
    private byte[] pendingData;

    @PluginMethod
    public void save(PluginCall call) {
        String name = call.getString("name", "document.pdf");
        String mime = call.getString("mime", "application/pdf");
        String data = call.getString("data");
        if (data == null) {
            call.reject("no data");
            return;
        }
        pendingData = Base64.decode(data, Base64.DEFAULT);
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mime);
        intent.putExtra(Intent.EXTRA_TITLE, name);
        startActivityForResult(call, intent, "onPicked");
    }

    @ActivityCallback
    private void onPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject ret = new JSObject();
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            ret.put("saved", false);
            call.resolve(ret);
            return;
        }
        Uri uri = result.getData().getData();
        try {
            OutputStream os = getContext().getContentResolver().openOutputStream(uri);
            if (os == null) throw new Exception("cannot write");
            os.write(pendingData);
            os.close();
            pendingData = null;
            ret.put("saved", true);
            ret.put("uri", uri.toString());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }
}
