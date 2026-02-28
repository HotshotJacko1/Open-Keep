import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.jackbarkerapps.openkeep',
  appName: 'Open Keep',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    hostname: 'example.com',
    allowNavigation: [
      'login.microsoftonline.com',
      'login.live.com',
      'login.microsoft.com'
    ]
  },
  plugins: {
    GoogleAuth: {
      scopes: ['profile', 'email', 'https://www.googleapis.com/auth/drive.file'],
      serverClientId: '889284625804-5prnhudcoalopvn0ad0au449lo1bn8f8.apps.googleusercontent.com',
      forceCodeForRefreshToken: true,
    },
  },
};

export default config;
