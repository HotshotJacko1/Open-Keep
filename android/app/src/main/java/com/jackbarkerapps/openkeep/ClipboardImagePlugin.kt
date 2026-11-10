// Copyright (c) 2026. Licensed under AGPLv3.
package com.jackbarkerapps.openkeep

import android.content.ClipboardManager
import android.content.Context
import android.util.Base64
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.ByteArrayOutputStream

/**
 * Reads images off the clipboard for a paste into a note (see clipboard-images.ts).
 *
 * The WebView can't do this safely. When the app that copied the image hasn't
 * shared it with us (ChatGPT, for one), reading it throws SecurityException
 * inside the WebView's own clipboard code, which nothing catches, and the
 * whole app crashes (Sentry OPENKEEP-17). Here that error is caught and
 * reported back as `denied`.
 */
@CapacitorPlugin(name = "ClipboardImage")
class ClipboardImagePlugin : Plugin() {

    @PluginMethod
    fun read(call: PluginCall) {
        val result = JSObject()
        val images = JSArray()
        var denied = false

        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
        val clip = try {
            clipboard?.primaryClip
        } catch (e: SecurityException) {
            denied = true
            null
        }

        if (clip != null) {
            for (i in 0 until clip.itemCount) {
                if (images.length() >= MAX_IMAGES) break
                val uri = clip.getItemAt(i).uri ?: continue
                try {
                    val mimeType = context.contentResolver.getType(uri)
                        ?: clip.description.filterMimeTypes("image/*")?.firstOrNull()
                    if (mimeType == null || !mimeType.startsWith("image/")) continue
                    val bytes = readCapped(uri) ?: continue
                    val image = JSObject()
                    image.put("data", Base64.encodeToString(bytes, Base64.NO_WRAP))
                    image.put("mimeType", mimeType)
                    images.put(image)
                } catch (e: SecurityException) {
                    denied = true
                } catch (e: Exception) {
                    // Gone, unreadable or too big: skip this one.
                }
            }
        }

        result.put("images", images)
        result.put("denied", denied)
        call.resolve(result)
    }

    /** The file's bytes, or null if it is missing or larger than MAX_BYTES. */
    private fun readCapped(uri: android.net.Uri): ByteArray? {
        context.contentResolver.openInputStream(uri)?.use { input ->
            val out = ByteArrayOutputStream()
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val n = input.read(buffer)
                if (n < 0) break
                out.write(buffer, 0, n)
                if (out.size() > MAX_BYTES) return null
            }
            return out.toByteArray()
        }
        return null
    }

    companion object {
        // A note holds at most 5 images (IMAGES_PER_NOTE_MAX in note-limits.ts).
        private const val MAX_IMAGES = 5
        // Before compression; saveImage shrinks it to ~0.3 MB afterwards.
        private const val MAX_BYTES = 20 * 1024 * 1024
    }
}
