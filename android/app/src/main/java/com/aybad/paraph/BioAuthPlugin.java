package com.aybad.paraph;

import android.os.Build;

import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Fingerprint / face unlock (Android BiometricPrompt); the phone's own PIN or pattern is offered as a fallback. */
@CapacitorPlugin(name = "BioAuth")
public class BioAuthPlugin extends Plugin {
    private static final int BIO = BiometricManager.Authenticators.BIOMETRIC_WEAK;
    private static final int BIO_OR_DEVICE = BIO | BiometricManager.Authenticators.DEVICE_CREDENTIAL;

    @PluginMethod
    public void isAvailable(PluginCall call) {
        BiometricManager bm = BiometricManager.from(getContext());
        int r = bm.canAuthenticate(BIO);
        JSObject o = new JSObject();
        o.put("available", r == BiometricManager.BIOMETRIC_SUCCESS);
        o.put("notEnrolled", r == BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED);
        o.put("code", r);
        call.resolve(o);
    }

    @PluginMethod
    public void authenticate(PluginCall call) {
        final String title = call.getString("title", "Paraph");
        final String subtitle = call.getString("subtitle", "");
        getActivity().runOnUiThread(() -> {
            try {
                FragmentActivity act = (FragmentActivity) getActivity();
                BiometricPrompt prompt = new BiometricPrompt(act, ContextCompat.getMainExecutor(getContext()),
                    new BiometricPrompt.AuthenticationCallback() {
                        @Override
                        public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                            JSObject o = new JSObject();
                            o.put("ok", true);
                            call.resolve(o);
                        }

                        @Override
                        public void onAuthenticationError(int code, CharSequence msg) {
                            call.reject(String.valueOf(msg), String.valueOf(code));
                        }
                    });
                BiometricPrompt.PromptInfo.Builder b = new BiometricPrompt.PromptInfo.Builder().setTitle(title);
                if (!subtitle.isEmpty()) b.setSubtitle(subtitle);
                if (Build.VERSION.SDK_INT >= 30) b.setAllowedAuthenticators(BIO_OR_DEVICE);
                else b.setDeviceCredentialAllowed(true);
                prompt.authenticate(b.build());
            } catch (Exception e) {
                call.reject(String.valueOf(e.getMessage()));
            }
        });
    }
}
