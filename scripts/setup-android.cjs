// Applies the app's native Android pieces to the generated android/ project (which is not
// versioned): the JW Library share target, talking to JW Library (open it, hand it a backup to
// restore, the accessibility robot that taps through it), the Google Drive sign-in through Play
// Services and Firebase push notifications.
// Safe to run any number of times; runs after `cap add android` and `cap sync`.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const ANDROID = path.join(ROOT, 'android');
const SOURCES = path.join(ROOT, 'mobile', 'android');
const PLAY_SERVICES_AUTH = 'com.google.android.gms:play-services-auth:21.3.0';
const JW_LIBRARY_PACKAGE = 'org.jw.jwlibrary.mobile';
const MARKER = 'jw-notes: JW Library';

if (!fs.existsSync(ANDROID)) {
  console.log('setup-android: pasta android/ não existe; rode "npm run mobile:add:android" primeiro.');
  process.exit(0);
}

const appId = /appId:\s*'([^']+)'/.exec(fs.readFileSync(path.join(ROOT, 'capacitor.config.ts'), 'utf8'))[1];
const javaDir = path.join(ANDROID, 'app', 'src', 'main', 'java', ...appId.split('.'));

// 1. Java sources (MainActivity registers the app's plugins).
for (const file of fs.readdirSync(path.join(SOURCES, 'java'))) {
  const source = fs.readFileSync(path.join(SOURCES, 'java', file), 'utf8').replace(/^package [\w.]+;/m, `package ${appId};`);
  fs.writeFileSync(path.join(javaDir, file), source);
}

const manifestPath = path.join(ANDROID, 'app', 'src', 'main', 'AndroidManifest.xml');
let manifest = fs.readFileSync(manifestPath, 'utf8');

// 2. Share target on MainActivity.
if (!manifest.includes(MARKER)) {
  const activityEnd = manifest.indexOf('</activity>', manifest.indexOf('android:name=".MainActivity"'));
  if (activityEnd < 0) throw new Error('setup-android: MainActivity não encontrada no AndroidManifest.xml');
  const lineStart = manifest.lastIndexOf('\n', activityEnd) + 1;
  const filters = fs.readFileSync(path.join(SOURCES, 'intent-filters.xml'), 'utf8');
  manifest = `${manifest.slice(0, lineStart)}${filters}\n${manifest.slice(lineStart)}`;
}

// 3. Since Android 11 other apps are invisible unless declared: needed to open JW Library.
if (!manifest.includes('<queries>')) {
  const queries = `    <queries>\n        <package android:name="${JW_LIBRARY_PACKAGE}" />\n    </queries>\n\n`;
  const appStart = manifest.indexOf('    <application');
  manifest = manifest.slice(0, appStart) + queries + manifest.slice(appStart);
}

// 4. The accessibility service that taps through JW Library (JwLibraryRobot) and its resources.
if (!manifest.includes('.JwLibraryRobot')) {
  const appEnd = manifest.lastIndexOf('    </application>');
  manifest = `${manifest.slice(0, appEnd)}${fs.readFileSync(path.join(SOURCES, 'robot-service.xml'), 'utf8')}${manifest.slice(appEnd)}`;
}
fs.writeFileSync(manifestPath, manifest);
for (const dir of fs.readdirSync(path.join(SOURCES, 'res'))) {
  const target = path.join(ANDROID, 'app', 'src', 'main', 'res', dir);
  fs.mkdirSync(target, { recursive: true });
  for (const file of fs.readdirSync(path.join(SOURCES, 'res', dir)))
    fs.copyFileSync(path.join(SOURCES, 'res', dir, file), path.join(target, file));
}

// 5. Play Services dependency for GoogleDriveAuthPlugin.
const gradlePath = path.join(ANDROID, 'app', 'build.gradle');
let gradle = fs.readFileSync(gradlePath, 'utf8');
if (!gradle.includes('play-services-auth')) {
  gradle = gradle.replace(/dependencies\s*\{/, (m) => `${m}\n    implementation "${PLAY_SERVICES_AUTH}"`);
  fs.writeFileSync(gradlePath, gradle);
}

// 6. Firebase config for push notifications (downloaded from the Firebase console; not versioned).
const firebaseConfig = path.join(SOURCES, 'google-services.json');
if (fs.existsSync(firebaseConfig)) fs.copyFileSync(firebaseConfig, path.join(ANDROID, 'app', 'google-services.json'));
else console.log('setup-android: sem mobile/android/google-services.json; as notificações ficam desligadas no Android.');

console.log(`setup-android: plugins nativos aplicados em ${path.relative(ROOT, javaDir)}`);
