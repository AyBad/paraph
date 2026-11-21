package com.aybad.paraph;

import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;

/** Gives the web app the file the user opened or shared with Paraph ("Open with" / "Share"). */
@CapacitorPlugin(name = "IncomingFile")
public class IncomingFilePlugin extends Plugin {
    static Intent pending;

    public void notifyIncoming() {
        notifyListeners("incoming", new JSObject());
    }

    @PluginMethod
    public void consume(PluginCall call) {
        Intent intent = pending != null ? pending : getActivity().getIntent();
        pending = null;
        JSObject ret = new JSObject();
        Uri uri = null;
        if (intent != null) {
            String action = intent.getAction();
            if (Intent.ACTION_VIEW.equals(action)) {
                uri = intent.getData();
            } else if (Intent.ACTION_SEND.equals(action)) {
                Object extra = intent.getExtras() != null ? intent.getExtras().get(Intent.EXTRA_STREAM) : null;
                if (extra instanceof Uri) uri = (Uri) extra;
            }
        }
        if (uri == null) {
            call.resolve(ret);
            return;
        }
        // consume it so it is not opened twice
        getActivity().setIntent(new Intent(Intent.ACTION_MAIN));
        try {
            ContentResolver cr = getContext().getContentResolver();
            String name = "document.pdf";
            Cursor c = cr.query(uri, null, null, null, null);
            if (c != null) {
                int idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (idx >= 0 && c.moveToFirst()) name = c.getString(idx);
                c.close();
            }
            InputStream in = cr.openInputStream(uri);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[65536];
            int n;
            while (in != null && (n = in.read(buf)) > 0) out.write(buf, 0, n);
            if (in != null) in.close();
            ret.put("name", name);
            ret.put("mime", cr.getType(uri));
            ret.put("data", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }
}
