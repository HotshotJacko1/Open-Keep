#!/usr/bin/env node
// Copyright (c) 2026. Licensed under AGPLv3.
//
// A tiny WebDAV server for trying Open Keep's WebDAV sync locally. Not for real
// use: no HTTPS, one account, files kept in a plain folder on this computer.
//
//   pnpm webdav:dev                     # user "test", password "test", port 8765
//   pnpm webdav:dev -- --user me --password pw --port 9000
//   pnpm webdav:dev -- --weak-etags   # W/"..." ETags, like many compressing servers
//
// It supports what Open Keep uses (GET, PUT, DELETE, MKCOL, with ETags,
// Last-Modified and If-Match / If-None-Match / If-Unmodified-Since) and sends CORS headers so the web app on another
// port can reach it. Open the printed address in a browser to see the files.
//
// Proxy mode, for testing a real server (Nextcloud etc.) from the web app:
//
//   pnpm webdav:dev -- --proxy https://cloud.example.com
//
// Forwards each request to that server unchanged and adds the CORS headers the
// browser needs, which Nextcloud doesn't send. Use the server's own WebDAV path
// on localhost, e.g. http://localhost:8765/remote.php/dav/files/alice/
// The username and password go straight through to the real server.

import http from "node:http";
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import { networkInterfaces } from "node:os";
import path from "node:path";

const arg = (name, fallback) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const PORT = Number(arg("port", 8765));
const USER = arg("user", "test");
const PASSWORD = arg("password", "test");
const DATA_DIR = path.resolve(arg("dir", ".webdav-dev-data"));
const WEAK_ETAGS = process.argv.includes("--weak-etags");
const PROXY = arg("proxy", null)?.replace(/\/+$/, "") ?? null;
if (PROXY && !/^https?:\/\//.test(PROXY)) {
    console.error("--proxy needs a full address, e.g. https://cloud.example.com");
    process.exit(1);
}
const EXPECTED_AUTH = "Basic " + Buffer.from(`${USER}:${PASSWORD}`, "utf8").toString("base64");

const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, PUT, DELETE, MKCOL, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, If-Match, If-None-Match, If-Unmodified-Since",
    "Access-Control-Expose-Headers": "ETag",
};

const etagOf = (body) => `${WEAK_ETAGS ? "W/" : ""}"${createHash("sha1").update(body).digest("hex").slice(0, 16)}"`;

/** URL path -> file on disk, refusing anything that would leave DATA_DIR. */
const diskPath = (urlPath) => {
    const resolved = path.resolve(DATA_DIR, "." + path.posix.normalize(urlPath));
    if (resolved !== DATA_DIR && !resolved.startsWith(DATA_DIR + path.sep)) return null;
    return resolved;
};

const stat = (p) => fs.stat(p).catch(() => null);

const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** Proxy mode: pass the request to the real server and its answer back, with CORS added. */
const forward = async (req, send, body) => {
    const headers = {};
    for (const name of ["authorization", "content-type", "if-match", "if-none-match", "if-unmodified-since"]) {
        if (req.headers[name]) headers[name] = req.headers[name];
    }
    let response;
    try {
        response = await fetch(PROXY + req.url, {
            method: req.method,
            headers,
            body: ["GET", "HEAD"].includes(req.method) ? undefined : body,
            redirect: "manual",
        });
    } catch (error) {
        console.error(`Couldn't reach ${PROXY}: ${error.cause?.message ?? error.message}`);
        return send(502, "Proxy couldn't reach the server");
    }
    if (response.status >= 300 && response.status < 400) {
        console.warn(`  The server redirected to ${response.headers.get("location")}. Use that address with --proxy.`);
    }
    const out = {};
    for (const name of ["etag", "last-modified", "content-type"]) {
        const value = response.headers.get(name);
        if (value) out[name] = value;
    }
    return send(response.status, Buffer.from(await response.arrayBuffer()), out);
};

const handle = async (req, res, body) => {
    const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const send = (status, text = "", headers = {}) => {
        const cond = ["if-match", "if-none-match", "if-unmodified-since"]
            .filter((h) => req.headers[h])
            .map((h) => ` ${h.replace(/(^|-)\w/g, (c) => c.toUpperCase())}: ${req.headers[h]}`)
            .join("");
        const etag = headers.ETag ?? headers.etag;
        if (req.method !== "OPTIONS") console.log(`${new Date().toLocaleTimeString()}  ${req.method.padEnd(6)} ${urlPath}  -> ${status}${cond}${etag ? `  (ETag ${etag})` : ""}`);
        res.writeHead(status, { ...CORS, ...headers });
        res.end(text);
    };

    if (req.method === "OPTIONS") return send(204);
    if (PROXY) return forward(req, send, body);
    if (req.headers.authorization !== EXPECTED_AUTH) {
        return send(401, "Wrong username or password", { "WWW-Authenticate": 'Basic realm="Open Keep test WebDAV"' });
    }

    const target = diskPath(urlPath);
    if (!target) return send(403);
    const info = await stat(target);

    switch (req.method) {
        case "GET":
        case "HEAD": {
            if (!info) return send(404);
            if (info.isDirectory()) {
                const entries = await fs.readdir(target, { withFileTypes: true });
                const base = urlPath.endsWith("/") ? urlPath : urlPath + "/";
                const items = entries.map((e) => {
                    const name = e.name + (e.isDirectory() ? "/" : "");
                    return `<li><a href="${escapeHtml(encodeURI(base + name))}">${escapeHtml(name)}</a></li>`;
                }).join("");
                return send(200, `<h1>${escapeHtml(urlPath)}</h1><ul>${items || "<li>(empty)</li>"}</ul>`, { "Content-Type": "text/html; charset=utf-8" });
            }
            const data = await fs.readFile(target);
            return send(200, req.method === "HEAD" ? "" : data, {
                ETag: etagOf(data),
                "Last-Modified": info.mtime.toUTCString(),
                "Content-Type": "application/json; charset=utf-8",
            });
        }
        case "PUT": {
            const parent = await stat(path.dirname(target));
            if (!parent?.isDirectory()) return send(409, "Parent folder doesn't exist");
            if (info?.isDirectory()) return send(405);
            const current = info ? etagOf(await fs.readFile(target)) : null;
            const ifMatch = req.headers["if-match"];
            if (ifMatch && ifMatch !== current) return send(412);
            if (req.headers["if-none-match"] === "*" && current) return send(412);
            // Last-Modified has whole-second precision, so compare in seconds.
            const ifUnmodifiedSince = Date.parse(req.headers["if-unmodified-since"] ?? "");
            if (info && !Number.isNaN(ifUnmodifiedSince) && Math.floor(info.mtimeMs / 1000) * 1000 > ifUnmodifiedSince) {
                return send(412);
            }
            await fs.writeFile(target, body);
            return send(info ? 204 : 201, "", { ETag: etagOf(body) });
        }
        case "DELETE": {
            if (!info) return send(404);
            await fs.rm(target, { recursive: true });
            return send(204);
        }
        case "MKCOL": {
            if (info) return send(405, "Already exists");
            const parent = await stat(path.dirname(target));
            if (!parent?.isDirectory()) return send(409, "Parent folder doesn't exist");
            await fs.mkdir(target);
            return send(201);
        }
    }
    return send(405);
};

if (!PROXY) await fs.mkdir(DATA_DIR, { recursive: true });

const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
        handle(req, res, Buffer.concat(chunks)).catch((error) => {
            console.error(error);
            res.writeHead(500, CORS);
            res.end();
        });
    });
});

if (PROXY) {
    // Only this computer: it relays to the real server with whatever credentials it's given.
    server.listen(PORT, "127.0.0.1", () => {
        console.log(`WebDAV CORS proxy for testing the web app against ${PROXY}\n`);
        console.log(`  In Open Keep, use http://localhost:${PORT} in place of ${PROXY}`);
        console.log(`  Nextcloud:  http://localhost:${PORT}/remote.php/dav/files/YOUR-USERNAME/\n`);
        console.log(`Each request and the real server's answer is listed below. Ctrl+C to stop.\n`);
    });
} else server.listen(PORT, "0.0.0.0", () => {
    const lan = Object.values(networkInterfaces()).flat()
        .filter((i) => i && i.family === "IPv4" && !i.internal)
        .map((i) => `http://${i.address}:${PORT}/`);
    console.log(`Open Keep test WebDAV server (not for real use: no HTTPS)\n`);
    console.log(`  WebDAV address:  http://localhost:${PORT}/`);
    for (const url of lan) console.log(`  On your network: ${url}`);
    console.log(`  Username:        ${USER}`);
    console.log(`  Password:        ${PASSWORD}`);
    console.log(`  Files saved in:  ${DATA_DIR}\n`);
    console.log(`Each request Open Keep makes is listed below. Ctrl+C to stop.\n`);
});
