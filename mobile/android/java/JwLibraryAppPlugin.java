package org.example.jwnotes;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;

/**
 * Talks to JW Library itself. Its database is private to it, so the only way to update it from
 * here is to hand it a backup file, which JW Library offers to restore.
 */
@CapacitorPlugin(name = "JwLibraryApp")
public class JwLibraryAppPlugin extends Plugin {

    private static final String JW_LIBRARY = "org.jw.jwlibrary.mobile";
    private static final String BACKUP_MIME = "application/octet-stream";

    @PluginMethod
    public void deviceName(PluginCall call) {
        // JW Library writes "Samsung_SM-X216B": manufacturer capitalised, then the model.
        String maker = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER;
        if (!maker.isEmpty()) maker = maker.substring(0, 1).toUpperCase() + maker.substring(1);
        JSObject ret = new JSObject();
        ret.put("name", (maker + "_" + Build.MODEL).replaceAll("\\s+", "_"));
        call.resolve(ret);
    }

    @PluginMethod
    public void open(PluginCall call) {
        Intent launch = getContext().getPackageManager().getLaunchIntentForPackage(JW_LIBRARY);
        if (launch == null) {
            call.reject("O JW Library não está instalado neste aparelho.");
            return;
        }
        getActivity().startActivity(launch);
        call.resolve();
    }

    /** Whether the robot (Settings › Accessibility › Editor de Notas) is on. */
    @PluginMethod
    public void robotStatus(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("enabled", JwLibraryRobot.isEnabled(getContext()));
        call.resolve(ret);
    }

    /** Opens the system screen where the user turns the robot on (Android does not allow doing it for them). */
    @PluginMethod
    public void openRobotSettings(PluginCall call) {
        getActivity().startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS));
        call.resolve();
    }

    /**
     * Opens JW Library and lets the robot make the backup and share it back to JW Notes, which
     * then receives it like any shared file (SharedBackupPlugin).
     */
    @PluginMethod
    public void backupAutomatically(PluginCall call) {
        if (!JwLibraryRobot.isEnabled(getContext())) {
            call.reject("Ative o Editor de Notas em Configurações › Acessibilidade.");
            return;
        }
        Intent launch = getContext().getPackageManager().getLaunchIntentForPackage(JW_LIBRARY);
        if (launch == null) {
            call.reject("O JW Library não está instalado neste aparelho.");
            return;
        }
        JwLibraryRobot.start(JwLibraryRobot.Mission.BACKUP);
        getActivity().startActivity(launch);
        call.resolve();
    }

    @PluginMethod
    public void restore(PluginCall call) {
        String path = call.getString("uri");
        if (path == null) {
            call.reject("Arquivo não informado.");
            return;
        }
        Uri content;
        try {
            File file = new File(Uri.parse(path).getPath());
            content = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
        } catch (Exception e) {
            call.reject("Não foi possível preparar o arquivo: " + e.getMessage(), e);
            return;
        }
        Intent view = new Intent(Intent.ACTION_VIEW)
            .setDataAndType(content, BACKUP_MIME)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        JSObject ret = new JSObject();
        // With the robot on, JW Library's "restore?" question is confirmed for the user.
        if (JwLibraryRobot.isEnabled(getContext())) JwLibraryRobot.start(JwLibraryRobot.Mission.RESTORE);
        try {
            getActivity().startActivity(new Intent(view).setPackage(JW_LIBRARY));
            ret.put("via", "jwlibrary");
        } catch (ActivityNotFoundException e) {
            // This JW Library version does not open files directly: let the user pick it.
            getActivity().startActivity(Intent.createChooser(view, "Restaurar no JW Library"));
            ret.put("via", "chooser");
        }
        call.resolve(ret);
    }
}
