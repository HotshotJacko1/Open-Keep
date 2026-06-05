import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.jackbarkerapps.openkeep',
  appName: 'Open Keep',
  webDir: 'dist',
  plugins: {
    GoogleAuth: {
      scopes: ['profile', 'email', 'https://www.googleapis.com/auth/drive.file'],
      clientId: '889284625804-5prnhudcoalopvn0ad0au449lo1bn8f8.apps.googleusercontent.com',
      serverClientId: '889284625804-5prnhudcoalopvn0ad0au449lo1bn8f8.apps.googleusercontent.com',
      iosClientId: '889284625804-4o32i9r7cun3pd9a471a6kno2rmgb4k1.apps.googleusercontent.com',
      forceCodeForRefreshToken: true,
    },
  },
};

export default config;
