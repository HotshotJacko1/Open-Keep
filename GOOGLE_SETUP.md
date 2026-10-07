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
2. **Web Client ID**: used by the web version, and as the server client ID for the native apps.
   - Authorized JavaScript origins: `http://localhost:8080` (the dev server) and your production origin (e.g. `https://app.openkeep.net`).
   - Authorized redirect URIs: the **same origins**. The web build gets its auth code from Google Identity Services' popup-mode code client, and the token exchange sends the calling page's origin as `redirect_uri`, so each origin must be registered here too.
3. **Android/iOS Client IDs**: (If using Capacitor) Create separate credentials for each platform using your App ID (`com.jackbarkerapps.openkeep`). The iOS client ID is set in `src/hooks/use-google-drive.ts`.

## 3. Enable Google Drive API
1. Go to **Enabled APIs & Services**.
2. Click **+ ENABLE APIS AND SERVICES**.
3. Search for **Google Drive API** and ensure it is **Enabled**.

## 4. Scopes
This app uses the `https://www.googleapis.com/auth/drive.file` scope. 
- This is a **Sensitive** scope.
- It only allows the app to see and manage files that **it created**. It cannot see the user's other Drive files.
- This is the safest scope for a notes app.

## 5. Client IDs in the app
The web client ID is read from `.env`, falling back to the Open Keep client built into `src/main.tsx`:

```env
VITE_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
```

The native apps sign in through the `@capgo/capacitor-social-login` plugin (`SocialLogin` in `capacitor.config.ts`), which is initialised with the web and iOS client IDs in `src/hooks/use-google-drive.ts`. Change them there if you use your own Google Cloud project.

## 6. Token exchange (Supabase edge function)
Auth codes are exchanged for tokens by the `google-token-exchange` edge function (`supabase/functions/google-token-exchange/`), so the client secret never ships in the app. Set the secret once:

```bash
supabase secrets set GOOGLE_CLIENT_SECRET=<your web client's secret>
```

Optionally set `GOOGLE_CLIENT_ID` too; it defaults to the Open Keep web client ID. Then deploy the function:

```bash
supabase functions deploy google-token-exchange
```
