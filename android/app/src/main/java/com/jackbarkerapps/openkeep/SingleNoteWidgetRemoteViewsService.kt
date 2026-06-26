package com.jackbarkerapps.openkeep

import android.appwidget.AppWidgetManager
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import com.jackbarkerapps.openkeep.data.NoteRepository
import com.jackbarkerapps.openkeep.security.KeyManager
import kotlinx.coroutines.runBlocking

class SingleNoteWidgetRemoteViewsService : RemoteViewsService() {

    override fun onGetViewFactory(intent: Intent): RemoteViewsFactory {
        val appWidgetId = intent.getIntExtra(
            AppWidgetManager.EXTRA_APPWIDGET_ID,
            AppWidgetManager.INVALID_APPWIDGET_ID
        )
        val dataString = intent.dataString ?: ""
        val noteId = dataString.substringAfterLast("/")

        return NoteContentViewsFactory(applicationContext, appWidgetId, noteId)
    }

    class NoteContentViewsFactory(
        private val context: android.content.Context,
        private val appWidgetId: Int,
        private val noteId: String
    ) : RemoteViewsFactory {

        data class LineEntry(
            val text: String,
            val type: Int // 0 = plain text, 1 = unchecked, 2 = checked
        )

        private val entries = mutableListOf<LineEntry>()
        private var rawLines: List<String> = emptyList()

        override fun onCreate() {
            loadNoteContent()
        }

        override fun onDataSetChanged() {
            loadNoteContent()
        }

        private fun loadNoteContent() {
            entries.clear()
            try {
                val keyManager = KeyManager(context)
                val masterKey = keyManager.getMasterKey() ?: return
                if (!NoteRepository.isInitialized()) {
                    NoteRepository.initialize(context, masterKey)
                }
                val dao = NoteRepository.getDatabase().noteDao()
                val note = runBlocking { dao.getNoteById(noteId) } ?: return

                rawLines = note.content.split("\n")

                for (line in rawLines) {
                    val trimmed = line.trimStart()
                    when {
                        trimmed.startsWith("- [ ]") -> {
                            val text = trimmed.removePrefix("- [ ]").trim()
                            entries.add(LineEntry(text, 1))
                        }
                        trimmed.startsWith("- [x]") -> {
                            val text = trimmed.removePrefix("- [x]").trim()
                            entries.add(LineEntry(text, 2))
                        }
                        trimmed.isNotBlank() -> {
                            entries.add(LineEntry(trimmed, 0))
                        }
                    }
                }
            } catch (e: Exception) {
                android.util.Log.e("SingleNoteWidget-RV", "Failed to load note content", e)
                entries.add(LineEntry("Error loading note", 0))
            }
        }

        override fun getCount(): Int = entries.size

        override fun getViewAt(position: Int): RemoteViews {
            val entry = entries[position]

            if (entry.type == 0) {
                // Plain text
                val views = RemoteViews(context.packageName, R.layout.widget_single_note_text_item)
                views.setTextViewText(android.R.id.text1, entry.text)
                return views
            }

            // Checklist item
            val views = RemoteViews(context.packageName, R.layout.widget_single_note_checklist_item)
            val isChecked = entry.type == 2

            views.setImageViewResource(
                R.id.widget_checkbox_icon,
                if (isChecked) android.R.drawable.checkbox_on_background
                else android.R.drawable.checkbox_off_background
            )

            val displayText = if (isChecked) "✓ $entry.text" else "☐ $entry.text"
            views.setTextViewText(R.id.widget_checklist_text, displayText)

            // Fill-in intent for checkbox toggle
            val fillInIntent = Intent().apply {
                putExtra(SingleNoteWidget.EXTRA_NOTE_ID, noteId)
                putExtra(SingleNoteWidget.EXTRA_LINE_INDEX, position)
                putExtra(SingleNoteWidget.EXTRA_APP_WIDGET_ID, appWidgetId)
                data = Uri.parse("toggle://$noteId/$position")
            }
            views.setOnClickFillInIntent(R.id.widget_checkbox_icon, fillInIntent)

            return views
        }

        override fun getLoadingView(): RemoteViews? = null
        override fun getViewTypeCount(): Int = 2
        override fun getItemId(position: Int): Long = position.toLong()
        override fun hasStableIds(): Boolean = true
    }
}