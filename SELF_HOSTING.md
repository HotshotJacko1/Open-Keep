# Self-hosting Open Keep

You can run the Open Keep web app on your own server, so nothing loads from openkeep.net. It comes as a Docker image: a small web server (nginx) with the app inside.

## What you get

- **The same web app**, served from your own address.
- **Notes stay in each browser**, encrypted, exactly as on openkeep.net. The server only hands out the app; it never stores notes. If you set a PIN, the copy that syncs is encrypted too.
- **Sync through WebDAV only**, for example your Nextcloud. Google Drive, Dropbox and OneDrive aren't offered: they sign in through Open Keep's own registrations with those companies, which only work on Open Keep's own addresses.
- **No contact with Open Keep's servers.** The self-hosted version has no usage counting, no page-view analytics, no feedback prompts and no error reporting. The links in Settings (website, privacy policy, support email) are still there, but nothing is sent unless you click them.

## Quick start

```sh
docker run -d --name open-keep -p 8080:8080 --restart unless-stopped \
  ghcr.io/hotshotjacko1/open-keep:latest
```

Open http://localhost:8080 on the same machine.

**Anywhere other than localhost you need HTTPS.** The app's encryption uses the browser's built-in crypto, which browsers only allow on `https://` pages (and on `localhost`). Put the container behind a reverse proxy that handles HTTPS. There's an example with Caddy [below](#example-with-https-caddy).

## Settings

Set these as environment variables on the container. They're read every time it starts, so there's no need to rebuild.

| Variable | What it does | Example |
|---|---|---|
| `OPENKEEP_WEBDAV_UPSTREAM` | Forwards `/webdav/` on your Open Keep address to your WebDAV server, so the browser sees one site (see [why](#connecting-to-nextcloud)). Just the server's address, optionally with a path; no trailing parts like `/remote.php`. | `https://cloud.example.com` |
| `OPENKEEP_WEBDAV_URL` | The WebDAV address the connect form starts with. Can be a path on your Open Keep site. Defaults to `/webdav/` when forwarding is on. | `/webdav/remote.php/dav/files/` |
| `OPENKEEP_WEBDAV_FOLDER` | The folder the connect form starts with. Defaults to `Open Keep`. | `Notes` |

Each person can still change the address and folder in the form; these only pre-fill it.

## Connecting to Nextcloud

Browsers have a safety rule: a web page can only talk to another site's server if that server explicitly allows it (CORS). Nextcloud doesn't by default, so an Open Keep site at `notes.example.com` can't reach a Nextcloud at `cloud.example.com` on its own. The phone apps aren't affected; this only matters in the browser. There are two ways round it.

### Option 1: let the container forward to Nextcloud (easiest)

```sh
docker run -d --name open-keep -p 8080:8080 --restart unless-stopped \
  -e OPENKEEP_WEBDAV_UPSTREAM=https://cloud.example.com \
  -e OPENKEEP_WEBDAV_URL=/webdav/remote.php/dav/files/ \
  ghcr.io/hotshotjacko1/open-keep:latest
```

Then in Open Keep: Settings → Open Sync Options → **Sync with WebDAV**.
- **WebDAV address:** it starts as `https://notes.example.com/webdav/remote.php/dav/files/`. Add your Nextcloud username and a `/` at the end. Nextcloud shows the exact username under Files → Files settings (bottom left) → WebDAV.
- **Username:** your Nextcloud login name.
- **App password:** create one in Nextcloud under Personal settings → Security → Devices & sessions, rather than using your main password.

The container passes the username and password straight through to Nextcloud and doesn't store them. Nextcloud sees every login as coming from the container's address, so its protection against password guessing counts everyone's failed logins together.

### Option 2: allow Open Keep in Nextcloud's reverse proxy (CORS)

If you'd rather not forward, configure the reverse proxy in front of Nextcloud to allow your Open Keep address. For requests to `/remote.php/dav/`:
- Allow the origin `https://notes.example.com`.
- Allow the methods `GET, PUT, DELETE, MKCOL, OPTIONS`.
- Allow the request headers `Authorization, Content-Type, If-Match, If-None-Match, If-Unmodified-Since`.
- Expose the response header `ETag`.
- Answer `OPTIONS` requests with these headers and no login.

Then use Nextcloud's own WebDAV address in the connect form.

## Example with HTTPS (Caddy)

`docker-compose.yml`:

```yaml
services:
  open-keep:
    image: ghcr.io/hotshotjacko1/open-keep:latest
    restart: unless-stopped
    environment:
      OPENKEEP_WEBDAV_UPSTREAM: https://cloud.example.com
      OPENKEEP_WEBDAV_URL: /webdav/remote.php/dav/files/

  caddy:
    image: caddy:2
    restart: unless-stopped
    ports: ["80:80", "443:443"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data

volumes:
  caddy-data:
```

`Caddyfile` (Caddy gets the HTTPS certificate itself; your domain must point at this server):

```
notes.example.com {
    reverse_proxy open-keep:8080
}
```

## Updating

```sh
docker pull ghcr.io/hotshotjacko1/open-keep:latest
docker rm -f open-keep
# then the same `docker run` as before
```

Notes aren't in the container, so updating or recreating it loses nothing. They are tied to the site's address in each browser, though: if you move Open Keep to a different address, each browser starts empty there. Sync, or Export and Import, brings them across.

## Backups

The server has nothing to back up. Notes live in each browser and, if you sync, in your WebDAV folder (`notes.json` and `encrypted_master_key.json`). Back up that folder, or use Settings → Export All Notes now and then.

## Building it yourself

From a checkout of this repository:

```sh
docker build -t open-keep .
docker run -d -p 8080:8080 open-keep
```

Without Docker: build with `VITE_APP_FLAVOR=selfhost pnpm build` and serve the `dist` folder from any web server. Send every path that isn't a file to `index.html`, and don't cache `index.html` or `config.js`. The settings above then go straight into `dist/config.js`, as `window.__OPEN_KEEP_CONFIG__ = { "webdavUrl": "...", "webdavFolder": "..." };`.

## Licence

Open Keep is licensed under the AGPLv3. If you change the code and let other people use your changed version over a network, you have to offer them its source code too.
