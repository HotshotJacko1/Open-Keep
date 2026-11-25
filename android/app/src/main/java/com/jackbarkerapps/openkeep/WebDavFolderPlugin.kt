// Copyright (c) 2026. Licensed under AGPLv3.
package com.jackbarkerapps.openkeep

import android.security.NetworkSecurityPolicy
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.BufferedReader
import java.io.IOException
import java.io.InputStreamReader
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URL
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLPeerUnverifiedException
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory

/**
 * Creates a folder on a WebDAV server (MKCOL), for WebDAV sync (src/lib/webdav.ts).
 *
 * Every other WebDAV request goes through CapacitorHttp, but that sits on
 * HttpURLConnection, which refuses any method outside its fixed list, MKCOL
 * included ("Invalid HTTP method"). This sends that one request directly on a
 * socket instead. It's a single bodiless request whose answer is only the
 * status line, so a full HTTP client isn't needed, and it adds no dependency.
 *
 * HTTPS uses the platform's default TLS setup, which applies the app's network
 * security config, and checks the certificate's hostname as HttpsURLConnection
 * does. Plain HTTP is refused unless that config allows it, like every other
 * request the app makes. A device-wide HTTP proxy isn't used.
 */
@CapacitorPlugin(name = "WebDavFolder")
class WebDavFolderPlugin : Plugin() {

    @PluginMethod
    fun create(call: PluginCall) {
        val url = call.getString("url")
        val authorization = call.getString("authorization")
        if (url.isNullOrEmpty() || authorization.isNullOrEmpty()) {
            call.reject("url and authorization are required")
            return
        }
        // Header injection: these go into the request verbatim.
        if (authorization.any { it == '\r' || it == '\n' }) {
            call.reject("Invalid authorization header")
            return
        }

        // Plugin calls share one thread; don't hold it for a network round trip.
        Thread {
            try {
                val status = mkcol(URL(url), authorization)
                call.resolve(JSObject().put("status", status))
            } catch (e: Exception) {
                call.reject(e.message ?: "Couldn't create the folder", e)
            }
        }.start()
    }

    private fun mkcol(url: URL, authorization: String): Int {
        val https = when (url.protocol) {
            "https" -> true
            "http" -> false
            else -> throw IOException("Unsupported protocol: ${url.protocol}")
        }
        // URL.host keeps the brackets of an IPv6 literal; the socket needs it without.
        val host = url.host.removeSurrounding("[", "]")
        if (!https && !NetworkSecurityPolicy.getInstance().isCleartextTrafficPermitted(host)) {
            throw IOException("Cleartext HTTP traffic to $host not permitted")
        }
        val port = if (url.port != -1) url.port else url.defaultPort

        val plain = Socket()
        try {
            plain.connect(InetSocketAddress(host, port), TIMEOUT_MS)
            plain.soTimeout = TIMEOUT_MS
        } catch (e: IOException) {
            plain.close()
            throw e
        }

        val socket: Socket = if (https) {
            // Layered on the connected socket; `host` also sets SNI.
            val factory = SSLSocketFactory.getDefault() as SSLSocketFactory
            val ssl = factory.createSocket(plain, host, port, true) as SSLSocket
            try {
                ssl.startHandshake()
                if (!HttpsURLConnection.getDefaultHostnameVerifier().verify(host, ssl.session)) {
                    throw SSLPeerUnverifiedException("Certificate doesn't match $host")
                }
            } catch (e: IOException) {
                ssl.close()
                throw e
            }
            ssl
        } else {
            plain
        }

        socket.use {
            // URL keeps the path and query as given, still percent-encoded.
            val path = url.path.ifEmpty { "/" } + (url.query?.let { q -> "?$q" } ?: "")
            val hostHeader = if (url.port == -1 || url.port == url.defaultPort) url.host else "${url.host}:$port"
            val request = "MKCOL $path HTTP/1.1\r\n" +
                "Host: $hostHeader\r\n" +
                "Authorization: $authorization\r\n" +
                "Content-Length: 0\r\n" +
                "User-Agent: Open Keep\r\n" +
                "Connection: close\r\n" +
                "\r\n"
            val output = it.getOutputStream()
            output.write(request.toByteArray(Charsets.UTF_8))
            output.flush()

            // "HTTP/1.1 201 Created" -> 201. The rest of the response doesn't matter.
            val statusLine = BufferedReader(InputStreamReader(it.getInputStream(), Charsets.ISO_8859_1)).readLine()
                ?: throw IOException("The server closed the connection without answering")
            return statusLine.split(' ').getOrNull(1)?.toIntOrNull()
                ?: throw IOException("Unexpected response from the server: $statusLine")
        }
    }

    private companion object {
        const val TIMEOUT_MS = 30_000
    }
}
