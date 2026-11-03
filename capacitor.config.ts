import type { CapacitorConfig } from '@capacitor/cli';

// Android and iOS shells. Run `npm run mobile:add:android` / `mobile:add:ios` once,
// then `npm run mobile:android` / `mobile:ios` to build and open the native project.
const config: CapacitorConfig = {
  appId: 'org.example.jwnotes',
  appName: 'Editor de Notas',
  webDir: 'dist/jw-notes/browser',
  server: {
    androidScheme: 'https',
  },
};

export default config;
