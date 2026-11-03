package org.example.jwnotes;

import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;
import androidx.core.content.IntentCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;

/**
 * Receives the file JW Library hands to the share sheet after "Criar backup", so the web app
 * can send it to Google Drive and sync without the user picking folders. Emits "received" with
 * { name, data (base64) } or { error }; events wait until the web app subscribes.
 */
@CapacitorPlugin(name = "SharedBackup")
public class SharedBackupPlugin extends Plugin {

    @Override
    public void load() {
        // The share that launched the app.
        if (handle(getActivity().getIntent())) getActivity().setIntent(new Intent(Intent.ACTION_MAIN));
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        handle(intent);
    }

    private boolean handle(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return false;
        Uri uri = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri.class);
        if (uri == null) return false;
        // The robot's backup mission ends here, whoever tapped the share target.
        JwLibraryRobot.finish(getContext());
        new Thread(() -> {
            JSObject event = new JSObject();
            try (InputStream in = getContext().getContentResolver().openInputStream(uri)) {
                if (in == null) throw new IllegalStateException("arquivo vazio");
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[64 * 1024];
                for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
                event.put("name", displayName(uri));
                event.put("data", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
            } catch (Exception e) {
                event.put("error", "Não foi possível ler o arquivo recebido: " + e.getMessage());
            }
            notifyListeners("received", event, true);
        }).start();
        return true;
    }

    private String displayName(Uri uri) {
        try (Cursor c = getContext().getContentResolver().query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (c != null && c.moveToFirst() && c.getString(0) != null) return c.getString(0);
        } catch (Exception ignored) {
            // Some providers do not answer queries; fall back to the URI.
        }
        String last = uri.getLastPathSegment();
        return last != null ? last : "";
    }
}
