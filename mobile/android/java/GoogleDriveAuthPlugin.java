package org.example.jwnotes;

import android.app.Activity;
import androidx.activity.result.ActivityResult;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.auth.GoogleAuthUtil;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.Scope;
import java.util.ArrayList;
import java.util.List;

/**
 * Google Drive access token on Android. Google refuses its web sign-in inside WebViews, so the
 * token comes from Google Play Services (Authorization API) instead. It needs an OAuth client of
 * type "Android" (package name + SHA-1 of the signing key) in the same Google Cloud project.
 */
@CapacitorPlugin(name = "GoogleDriveAuth")
public class GoogleDriveAuthPlugin extends Plugin {

    private ActivityResultLauncher<IntentSenderRequest> consent;
    private PluginCall waitingForConsent;

    @Override
    public void load() {
        consent = bridge.registerForActivityResult(new ActivityResultContracts.StartIntentSenderForResult(), this::onConsent);
    }

    @PluginMethod
    public void authorize(PluginCall call) {
        List<Scope> scopes = new ArrayList<>();
        try {
            JSArray requested = call.getArray("scopes", new JSArray());
            for (Object s : requested.toList()) scopes.add(new Scope(String.valueOf(s)));
        } catch (Exception e) {
            call.reject("Escopos inválidos.", e);
            return;
        }
        AuthorizationRequest request = AuthorizationRequest.builder().setRequestedScopes(scopes).build();
        Identity.getAuthorizationClient(getActivity())
            .authorize(request)
            .addOnSuccessListener(result -> {
                if (result.hasResolution() && result.getPendingIntent() != null) {
                    // First time (or after revoking): Google shows the account picker and consent screen.
                    waitingForConsent = call;
                    consent.launch(new IntentSenderRequest.Builder(result.getPendingIntent().getIntentSender()).build());
                } else {
                    resolve(call, result);
                }
            })
            .addOnFailureListener(e -> call.reject("Login no Google falhou: " + e.getMessage(), e));
    }

    /** Drops the cached token so the next authorize() fetches a fresh one (or asks again). */
    @PluginMethod
    public void clearToken(PluginCall call) {
        String token = call.getString("accessToken");
        if (token == null) {
            call.resolve();
            return;
        }
        new Thread(() -> {
            try {
                GoogleAuthUtil.clearToken(getContext(), token);
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage(), e);
            }
        }).start();
    }

    private void onConsent(ActivityResult r) {
        PluginCall call = waitingForConsent;
        waitingForConsent = null;
        if (call == null) return;
        if (r.getResultCode() != Activity.RESULT_OK || r.getData() == null) {
            call.reject("Login no Google cancelado.");
            return;
        }
        try {
            resolve(call, Identity.getAuthorizationClient(getActivity()).getAuthorizationResultFromIntent(r.getData()));
        } catch (Exception e) {
            call.reject("Login no Google falhou: " + e.getMessage(), e);
        }
    }

    private void resolve(PluginCall call, AuthorizationResult result) {
        String token = result.getAccessToken();
        if (token == null) {
            call.reject("O Google não devolveu um token de acesso.");
            return;
        }
        JSObject ret = new JSObject();
        ret.put("accessToken", token);
        call.resolve(ret);
    }
}
