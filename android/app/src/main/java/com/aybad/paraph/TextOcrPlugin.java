package com.aybad.paraph;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Rect;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

/** On-device text recognition (Google ML Kit, offline): words with their position in the picture. */
@CapacitorPlugin(name = "TextOcr")
public class TextOcrPlugin extends Plugin {
    private TextRecognizer recognizer;

    @PluginMethod
    public void recognize(PluginCall call) {
        String data = call.getString("data");
        if (data == null) { call.reject("no data"); return; }
        Bitmap bmp;
        try {
            byte[] bytes = Base64.decode(data, Base64.DEFAULT);
            bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
        } catch (Exception e) { call.reject("decode: " + e.getMessage()); return; }
        if (bmp == null) { call.reject("decode"); return; }
        final int bw = bmp.getWidth(), bh = bmp.getHeight();
        if (recognizer == null) recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
        InputImage image = InputImage.fromBitmap(bmp, 0);
        recognizer.process(image)
            .addOnSuccessListener(text -> {
                JSArray words = new JSArray();
                for (Text.TextBlock block : text.getTextBlocks()) {
                    for (Text.Line line : block.getLines()) {
                        for (Text.Element el : line.getElements()) {
                            Rect r = el.getBoundingBox();
                            if (r == null) continue;
                            JSObject w = new JSObject();
                            w.put("t", el.getText());
                            w.put("x", r.left); w.put("y", r.top);
                            w.put("w", r.width()); w.put("h", r.height());
                            words.put(w);
                        }
                    }
                }
                JSObject ret = new JSObject();
                ret.put("words", words);
                ret.put("width", bw); ret.put("height", bh);
                call.resolve(ret);
            })
            .addOnFailureListener(e -> call.reject("ocr: " + e.getMessage()));
    }
}
