package org.example.jwnotes;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.content.ComponentName;
import android.content.Context;
import android.graphics.Path;
import android.graphics.Rect;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.util.Log;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Drives JW Library's own screens, since its database is private to it: for a backup it taps
 * Estudo Pessoal › Backup e restauração › Fazer backup and picks "Sincronizar backup" in the share
 * sheet; for an update it confirms the restore of the file JW Notes handed over.
 *
 * It only acts during a short mission started by JW Notes; the rest of the time every event is
 * ignored, so normal use of JW Library is never touched. During a backup it never taps anything
 * that mentions restoring. Screens mapped on JW Library 15.9.2 (pt-BR); ids are stable across
 * languages, texts are matched in a few languages as a fallback.
 */
public class JwLibraryRobot extends AccessibilityService {

    enum Mission { NONE, BACKUP, RESTORE }

    private enum Stage { OPEN_MENU, WAIT_SHARE, WAIT_CONFIRM }

    static final String JW_LIBRARY = "org.jw.jwlibrary.mobile";
    /** Every tap is logged (adb logcat JwNotes:V *:S), so a run can be checked afterwards. */
    private static final String TAG = "JwNotes";
    /** Label of JW Notes' share target (mobile/android/intent-filters.xml) and the app name, as fallback. */
    private static final String[] SHARE_TARGETS = { "Sincronizar backup", "Editor de Notas" };
    /** Samsung's share sheet shows a few apps and hides the rest behind this button. */
    private static final String[] MORE_TARGETS = { "Mais", "More", "Más" };
    private static final String[] BACKUP_ITEMS = { "Fazer backup", "Criar backup", "Back up", "Backup", "Hacer copia", "Crear copia" };
    private static final String[] RESTORE_WORDS = { "restaur", "restore" };
    private static final long MISSION_MS = 60_000;
    private static final long SETTLE_MS = 400;
    private static final int MAX_BACKS = 5;
    /** JW Library's first screens (splash, loading) have no menu yet: going back there closes it. */
    private static final long BACK_GRACE_MS = 4_000;
    private static final int MAX_SCROLLS = 10;

    private static volatile JwLibraryRobot instance;
    private static volatile Mission mission = Mission.NONE;
    private static volatile Stage stage = Stage.OPEN_MENU;
    private static volatile long deadline;
    private static volatile long started;
    private static int backs;
    private static int scrolls;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable step = this::step;

    /**
     * True when the user turned the robot on in Settings › Accessibility. Read from the setting,
     * not from the running service: right after the app starts (e.g. from a notification) Android
     * may not have connected it yet, and a mission started now is picked up once it does.
     */
    static boolean isEnabled(Context context) {
        if (instance != null) return true;
        String enabled = Settings.Secure.getString(context.getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
        if (enabled == null) return false;
        ComponentName me = new ComponentName(context, JwLibraryRobot.class);
        for (String service : enabled.split(":")) {
            if (me.equals(ComponentName.unflattenFromString(service))) return true;
        }
        return false;
    }

    static void start(Mission m) {
        mission = m;
        stage = m == Mission.RESTORE ? Stage.WAIT_CONFIRM : Stage.OPEN_MENU;
        started = SystemClock.uptimeMillis();
        deadline = started + MISSION_MS;
        backs = 0;
        scrolls = 0;
        Log.i(TAG, "robô: missão " + m);
    }

    static void finish() {
        if (mission != Mission.NONE) Log.i(TAG, "robô: fim da missão " + mission);
        mission = Mission.NONE;
    }

    @Override
    protected void onServiceConnected() {
        instance = this;
    }

    @Override
    public boolean onUnbind(android.content.Intent intent) {
        instance = null;
        return super.onUnbind(intent);
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (mission == Mission.NONE) return;
        // Screens arrive as bursts of events: act once things settle.
        handler.removeCallbacks(step);
        handler.postDelayed(step, SETTLE_MS);
    }

    @Override
    public void onInterrupt() {}

    private void step() {
        if (mission == Mission.NONE) return;
        if (SystemClock.uptimeMillis() > deadline) {
            Log.w(TAG, "robô: tempo esgotado em " + stage);
            finish();
            return;
        }
        List<AccessibilityNodeInfo> roots = roots();
        if (mission == Mission.BACKUP) backupStep(roots);
        else confirmRestoreStep(roots);
    }

    private void backupStep(List<AccessibilityNodeInfo> roots) {
        if (stage == Stage.WAIT_SHARE) {
            List<AccessibilityNodeInfo> sheets = shareSheets(roots);
            if (sheets.isEmpty()) return; // JW Library is still writing the backup
            for (String label : SHARE_TARGETS) {
                if (click(findText(sheets, label, false))) {
                    // JW Notes takes it from here (SharedBackupPlugin).
                    finish();
                    return;
                }
            }
            // The target may be further down the share sheet.
            if (scrolls++ < MAX_SCROLLS) scrollForward(sheets);
            return;
        }

        AccessibilityNodeInfo item = backupMenuItem(roots);
        if (item != null) {
            if (click(item)) stage = Stage.WAIT_SHARE;
            return;
        }
        if (click(findId(roots, "action_backup_restore"))) return;
        if (click(findId(roots, "nav_personal_study"))) return;
        // Somewhere deeper in JW Library (reading a publication…): go back to the main screens.
        if (!isJwLibraryInFront()) return;
        long wait = started + BACK_GRACE_MS - SystemClock.uptimeMillis();
        if (wait > 0) {
            // Still starting up: look again once it had time to show its menu.
            handler.removeCallbacks(step);
            handler.postDelayed(step, wait);
            return;
        }
        if (backs++ < MAX_BACKS) {
            Log.i(TAG, "robô: voltar");
            performGlobalAction(GLOBAL_ACTION_BACK);
        }
    }

    private void confirmRestoreStep(List<AccessibilityNodeInfo> roots) {
        if (!isJwLibraryInFront()) return;
        // Standard dialog buttons: button1 is the positive one ("Restaurar"/"OK").
        AccessibilityNodeInfo positive = findFullId(roots, "android:id/button1");
        if (positive == null) positive = findFullId(roots, JW_LIBRARY + ":id/button1");
        if (positive != null) Log.i(TAG, "robô: diálogo de restauração: " + texts(getRootInActiveWindow()));
        if (click(positive)) finish();
    }

    /** The visible texts under `node`, for the log. */
    private static String texts(AccessibilityNodeInfo node) {
        StringBuilder out = new StringBuilder();
        collectTexts(node, out);
        return out.toString();
    }

    private static void collectTexts(AccessibilityNodeInfo node, StringBuilder out) {
        if (node == null) return;
        if (node.getText() != null) out.append(" «").append(node.getText()).append('»');
        for (int i = 0; i < node.getChildCount(); i++) collectTexts(node.getChild(i), out);
    }

    /** "Fazer backup" in the Backup e restauração menu, never the restore item next to it. */
    private AccessibilityNodeInfo backupMenuItem(List<AccessibilityNodeInfo> roots) {
        for (String text : BACKUP_ITEMS) {
            AccessibilityNodeInfo node = findText(roots, text, true);
            if (node != null && !mentionsRestore(node)) return node;
        }
        return null;
    }

    private boolean mentionsRestore(AccessibilityNodeInfo node) {
        CharSequence text = node.getText();
        String t = text == null ? "" : text.toString().toLowerCase(Locale.ROOT);
        for (String w : RESTORE_WORDS) if (t.contains(w)) return true;
        return false;
    }

    /** Windows of other apps in front (the system share sheet), never JW Library's or JW Notes' own. */
    private List<AccessibilityNodeInfo> shareSheets(List<AccessibilityNodeInfo> roots) {
        List<AccessibilityNodeInfo> out = new ArrayList<>();
        AccessibilityNodeInfo active = getRootInActiveWindow();
        if (active == null) return out;
        CharSequence pkg = active.getPackageName();
        if (pkg == null || samePackage(pkg, JW_LIBRARY) || samePackage(pkg, getPackageName())) return out;
        for (AccessibilityNodeInfo r : roots) if (samePackage(r.getPackageName(), pkg.toString())) out.add(r);
        return out;
    }

    private List<AccessibilityNodeInfo> roots() {
        List<AccessibilityNodeInfo> out = new ArrayList<>();
        for (AccessibilityWindowInfo w : getWindows()) {
            AccessibilityNodeInfo r = w.getRoot();
            if (r != null) out.add(r);
        }
        if (out.isEmpty() && getRootInActiveWindow() != null) out.add(getRootInActiveWindow());
        return out;
    }

    private boolean isJwLibraryInFront() {
        AccessibilityNodeInfo active = getRootInActiveWindow();
        return active != null && samePackage(active.getPackageName(), JW_LIBRARY);
    }

    private AccessibilityNodeInfo findId(List<AccessibilityNodeInfo> roots, String id) {
        return findFullId(roots, JW_LIBRARY + ":id/" + id);
    }

    private AccessibilityNodeInfo findFullId(List<AccessibilityNodeInfo> roots, String fullId) {
        for (AccessibilityNodeInfo r : roots) {
            List<AccessibilityNodeInfo> found = r.findAccessibilityNodeInfosByViewId(fullId);
            for (AccessibilityNodeInfo n : found) if (n.isVisibleToUser()) return n;
        }
        return null;
    }

    /** A visible node whose text (or description) is exactly `text`, ignoring case; `inJwLibrary` limits it to JW Library's windows. */
    private AccessibilityNodeInfo findText(List<AccessibilityNodeInfo> roots, String text, boolean inJwLibrary) {
        for (AccessibilityNodeInfo r : roots) {
            if (inJwLibrary && !samePackage(r.getPackageName(), JW_LIBRARY)) continue;
            for (AccessibilityNodeInfo n : r.findAccessibilityNodeInfosByText(text)) {
                if (!n.isVisibleToUser()) continue;
                CharSequence t = n.getText() != null ? n.getText() : n.getContentDescription();
                if (t != null && t.toString().trim().equalsIgnoreCase(text)) return n;
            }
        }
        return null;
    }

    /**
     * Reveals more of the share sheet. On Samsung the apps are a horizontal row that accepts the
     * scroll action without moving, so a row cut off at its right edge is dragged like a finger
     * would, and at its end "Mais" opens the full list; otherwise the innermost list that still
     * moves is scrolled.
     */
    private void scrollForward(List<AccessibilityNodeInfo> sheets) {
        List<AccessibilityNodeInfo> lists = new ArrayList<>();
        for (AccessibilityNodeInfo r : sheets) collectScrollables(r, lists);
        for (AccessibilityNodeInfo s : lists) {
            if (overflowingRow(s)) {
                swipeLeft(s);
                return;
            }
        }
        for (String label : MORE_TARGETS) if (click(findText(sheets, label, false))) return;
        for (AccessibilityNodeInfo s : lists) {
            if (s.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD)) {
                Log.i(TAG, "robô: rolar " + s.getViewIdResourceName());
                return;
            }
        }
    }

    /** A single-line row whose last item reaches its right edge, i.e. more items hide past it. */
    private static boolean overflowingRow(AccessibilityNodeInfo row) {
        Rect box = new Rect();
        row.getBoundsInScreen(box);
        if (box.width() < box.height() * 2 || row.getChildCount() == 0) return false;
        AccessibilityNodeInfo first = row.getChild(0);
        AccessibilityNodeInfo last = row.getChild(row.getChildCount() - 1);
        if (first == null || last == null) return false;
        Rect start = new Rect();
        Rect end = new Rect();
        first.getBoundsInScreen(start);
        last.getBoundsInScreen(end);
        return start.top == end.top && end.right >= box.right - 8;
    }

    private void swipeLeft(AccessibilityNodeInfo row) {
        Rect box = new Rect();
        row.getBoundsInScreen(box);
        Path path = new Path();
        path.moveTo(box.right - box.width() / 10f, box.centerY());
        path.lineTo(box.left + box.width() / 10f, box.centerY());
        GestureDescription swipe = new GestureDescription.Builder()
            .addStroke(new GestureDescription.StrokeDescription(path, 0, 300))
            .build();
        Log.i(TAG, "robô: arrastar " + row.getViewIdResourceName());
        dispatchGesture(swipe, null, null);
    }

    /** Scrollable nodes under `node`, innermost first. */
    private static void collectScrollables(AccessibilityNodeInfo node, List<AccessibilityNodeInfo> out) {
        if (node == null) return;
        for (int i = 0; i < node.getChildCount(); i++) collectScrollables(node.getChild(i), out);
        if (node.isScrollable()) out.add(node);
    }

    private static String describe(AccessibilityNodeInfo node) {
        CharSequence label = node.getText() != null ? node.getText() : node.getContentDescription();
        return "«" + label + "» " + node.getViewIdResourceName() + " (" + node.getPackageName() + ")";
    }

    private static boolean samePackage(CharSequence pkg, String name) {
        return pkg != null && name.contentEquals(pkg);
    }

    /** Clicks the node or its nearest clickable ancestor. */
    private static boolean click(AccessibilityNodeInfo node) {
        for (AccessibilityNodeInfo n = node; n != null; n = n.getParent()) {
            if (n.isClickable() && n.isEnabled()) {
                Log.i(TAG, "robô: toque em " + describe(node));
                return n.performAction(AccessibilityNodeInfo.ACTION_CLICK);
            }
        }
        return false;
    }
}
