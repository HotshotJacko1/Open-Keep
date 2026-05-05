# Google Cloud Project Setup for Google Drive Sync

Follow these steps to configure your Google Cloud project to allow users to sync their notes.

## 1. OAuth Consent Screen Configuration
The "Access blocked" error occurs when your app is in "Testing" mode but the user isn't on the "Test users" list.

### Option A: Add Test Users (For development/private use)
1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Navigate to **APIs & Services** > **OAuth consent screen**.
3. Scroll down to **Test users**.
4. Click **+ ADD USERS**.
5. Enter the email addresses of the people you want to allow (e.g., `jackbarker635@gmail.com`).
6. Click **SAVE**.

### Option B: Publish App (For public use)
1. Go to the **OAuth consent screen** page.
2. Under **Publishing status**, click **PUBLISH APP**.
3. Confirm the dialog.
4. Your app is now "In Production". Anyone with a Google account can sign in, but they will see a "This app isn't verified" warning.
5. To proceed past the warning, users must click **Advanced** > **Go to Open Keep (unsafe)**.

## 2. API Credentials
Ensure you have the correct credentials set up.

1. Go to **APIs & Services** > **Credentials**.
2. **Web Client ID**: Used for the web version of the app.
   - Authorized Javascript Origins: `http://localhost:5173` (or your dev URL).
   - Authorized Redirect URIs: `http://localhost:5173`.
3. **Android/iOS Client IDs**: (If using Capacitor) Create separate credentials for each platform using your App ID (`com.jackbarkerapps.openkeep`).

## 3. Enable Google Drive API
1. Go to **Enabled APIs & Services**.
2. Click **+ ENABLE APIS AND SERVICES**.
3. Search for **Google Drive API** and ensure it is **Enabled**.

## 4. Scopes
This app uses the `https://www.googleapis.com/auth/drive.file` scope. 
- This is a **Sensitive** scope.
- It only allows the app to see and manage files that **it created**. It cannot see the user's other Drive files.
- This is the safest scope for a notes app.

## 5. Update Environment Variables
Ensure your `.env` file has the correct IDs:

```env
VITE_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
VITE_GOOGLE_API_KEY=your-api-key
```

And in `capacitor.config.ts`:
```typescript
plugins: {
  GoogleAuth: {
    serverClientId: 'your-client-id.apps.googleusercontent.com',
    // ...
  }
}
```
