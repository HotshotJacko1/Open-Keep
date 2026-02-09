# Azure App Registration for OneDrive Sync

Follow these steps to register your app and get the necessary credentials.

## 1. Create the App Registration
1. Go to the [Azure Portal](https://portal.azure.com/) and sign in.
2. Search for **"App registrations"** in the top search bar and select it.
3. Click **"+ New registration"**.
4. **Name**: Enter a name for your app (e.g., `Open Keep Mobile`).
5. **Supported account types**: Select **"Accounts in any organizational directory (Any Microsoft Entra ID tenant - Multitenant) and personal Microsoft accounts (e.g. Skype, Xbox)"**.
   * *Critical for allowing personal OneDrive users to log in.*
6. **Redirect URI**:
   * Select **"Single-page application (SPA)"** from the dropdown.
   * Enter your Redirect URI.
   * **For Mobile Dev**: Enter `http://localhost` (recommended for local development).
   * **If your app showed a specific URI**: Add that one as well (e.g., `capacitor://localhost` or `http://192.168.x.x`).
7. Click **"Register"**.

## 2. Configure Authentication
1. Once created, go to the **"Authentication"** blade (left menu).
2. Ensure **"v2.0"** is implied (Modern auth usually defaults to this).
3. Under **"Implicit grant and hybrid flows"**, you generally **do NOT** need to check Access tokens/ID tokens if using the MSAL 2.0+ Auth Code Flow (which `msal-browser` uses).
   * *However, if you run into issues, you can try enabling them, but start without.*
4. Ensure your Redirect URIs are listed under **"Single-page application"**.

## 3. Get your Client ID
1. Go to the **"Overview"** blade.
2. Copy the **"Application (client) ID"**.

## 4. Update your Project
1. Open your project's `.env` file (create one in the project root if it doesn't exist).
2. Add the Client ID:
   ```env
   VITE_MICROSOFT_CLIENT_ID=your-copied-client-id
   ```
3. (Optional) If you are using a special redirect URI:
   ```env
   VITE_ONEDRIVE_REDIRECT_URI=http://your-custom-uri
   ```

## 5. Rebuild
After updating the `.env` file, **rebuild your app** locally to apply the changes.
