package com.aybad.paraph;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.play.core.review.ReviewInfo;
import com.google.android.play.core.review.ReviewManager;
import com.google.android.play.core.review.ReviewManagerFactory;

/** Google Play in-app review: the rating card is shown inside the app (Google decides how often it really appears). */
@CapacitorPlugin(name = "PlayReview")
public class PlayReviewPlugin extends Plugin {
    @PluginMethod
    public void request(PluginCall call) {
        final ReviewManager manager = ReviewManagerFactory.create(getContext());
        manager.requestReviewFlow().addOnCompleteListener(task -> {
            if (!task.isSuccessful()) { call.reject("unavailable"); return; }
            ReviewInfo info = task.getResult();
            manager.launchReviewFlow(getActivity(), info).addOnCompleteListener(done -> {
                JSObject o = new JSObject();
                o.put("done", true);
                call.resolve(o);
            });
        });
    }
}
