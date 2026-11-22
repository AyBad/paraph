package com.aybad.paraph;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.database.Cursor;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
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

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

/** "Save as…": the system file picker lets the user choose where to store the file on the phone. */
@CapacitorPlugin(name = "SaveAs")
public class SaveAsPlugin extends Plugin {
    private File pending() { return new File(getContext().getCacheDir(), "paraph-save-as.tmp"); }

    /**
     * Writes the file straight into the phone's Downloads/Paraph folder (MediaStore, no permission needed
     * on Android 10+), then checks its size. Resolves { saved, path, size }.
     */
    @PluginMethod
    public void saveToDownloads(PluginCall call) {
        String name = call.getString("name", "document.pdf");
        String mime = call.getString("mime", "application/pdf");
        String data = call.getString("data");
        if (data == null) { call.reject("no data"); return; }
        byte[] bytes;
        try { bytes = Base64.decode(data, Base64.DEFAULT); } catch (Exception e) { call.reject("decode: " + e.getMessage()); return; }
        if (bytes.length == 0) { call.reject("empty"); return; }
        try {
            long size;
            if (Build.VERSION.SDK_INT >= 29) {
                ContentResolver cr = getContext().getContentResolver();
                ContentValues v = new ContentValues();
                v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
                v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Paraph");
                v.put(MediaStore.MediaColumns.IS_PENDING, 1);
                Uri uri = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                if (uri == null) throw new Exception("insert");
                try (OutputStream os = cr.openOutputStream(uri, "w")) {
                    if (os == null) throw new Exception("stream");
                    os.write(bytes);
                    os.flush();
                }
                ContentValues done = new ContentValues();
                done.put(MediaStore.MediaColumns.IS_PENDING, 0);
                cr.update(uri, done, null, null);
                size = 0;
                try (Cursor c = cr.query(uri, new String[]{OpenableColumns.SIZE, OpenableColumns.DISPLAY_NAME}, null, null, null)) {
                    if (c != null && c.moveToFirst()) { size = c.getLong(0); name = c.getString(1); }
                }
                if (size == 0) { cr.delete(uri, null, null); throw new Exception("written file is empty"); }
            } else {
                File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "Paraph");
                if (!dir.exists() && !dir.mkdirs()) throw new Exception("mkdirs");
                File f = new File(dir, name);
                int n = 1;
                String base = name.contains(".") ? name.substring(0, name.lastIndexOf('.')) : name, ext = name.contains(".") ? name.substring(name.lastIndexOf('.')) : "";
                while (f.exists()) f = new File(dir, base + " (" + (n++) + ")" + ext);
                try (FileOutputStream fo = new FileOutputStream(f)) { fo.write(bytes); }
                size = f.length();
                name = f.getName();
                if (size == 0) throw new Exception("written file is empty");
            }
            JSObject ret = new JSObject();
            ret.put("saved", true);
            ret.put("name", name);
            ret.put("size", size);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(String.valueOf(e.getMessage()));
        }
    }

    @PluginMethod
    public void save(PluginCall call) {
        String name = call.getString("name", "document.pdf");
        String mime = call.getString("mime", "application/pdf");
        String data = call.getString("data");
        if (data == null) {
            call.reject("no data");
            return;
        }
        try (FileOutputStream fo = new FileOutputStream(pending())) {
            fo.write(Base64.decode(data, Base64.DEFAULT));
        } catch (Exception e) {
            call.reject("tmp: " + e.getMessage());
            return;
        }
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
        File tmp = pending();
        try (InputStream in = new FileInputStream(tmp); OutputStream os = getContext().getContentResolver().openOutputStream(uri, "wt")) {
            if (os == null) throw new Exception("cannot write");
            byte[] buf = new byte[65536];
            int n;
            long total = 0;
            while ((n = in.read(buf)) > 0) { os.write(buf, 0, n); total += n; }
            os.flush();
            if (total == 0) throw new Exception("empty");
            tmp.delete();
            ret.put("saved", true);
            ret.put("uri", uri.toString());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }
}
