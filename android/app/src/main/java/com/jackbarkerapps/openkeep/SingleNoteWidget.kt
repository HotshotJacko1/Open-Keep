package com.jackbarkerapps.openkeep

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews
import com.jackbarkerapps.openkeep.data.NoteEntity
import com.jackbarkerapps.openkeep.data.NoteRepository
import com.jackbarkerapps.openkeep.security.KeyManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.flow.first

class SingleNoteWidget : AppWidgetProvider() {

    companion object {
        const val PREFS_NAME = "single_note_widget_prefs"
        const val KEY_NOTE_ID = "note_id_"
        const val ACTION_TOGGLE_CHECKBOX = "com.jackbarkerapps.openkeep.TOGGLE_CHECKBOX"
        const val EXTRA_NOTE_ID = "extra_note_id"
        const val EXTRA_LINE_INDEX = "extra_line_index"
        const val EXTRA_APP_WIDGET_ID = "extra_app_widget_id"
    }

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray
    ) {
        for (appWidgetId in appWidgetIds) {
            updateWidgetAppearance(context, appWidgetManager, appWidgetId)
        }
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)

        if (ACTION_TOGGLE_CHECKBOX == intent.action) {
            val noteId = intent.getStringExtra(EXTRA_NOTE_ID) ?: return
            val lineIndex = intent.getIntExtra(EXTRA_LINE_INDEX, -1)
            val appWidgetId = intent.getIntExtra(EXTRA_APP_WIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
            if (lineIndex < 0 || appWidgetId == AppWidgetManager.INVALID_APPWIDGET_ID) return

            toggleCheckbox(context, noteId, lineIndex)

            val appWidgetManager = AppWidgetManager.getInstance(context)
            updateWidgetAppearance(context, appWidgetManager, appWidgetId)
        }
    }

    private fun toggleCheckbox(context: Context, noteId: String, lineIndex: Int) {
        CoroutineScope(Dispatchers.IO).run {
            try {
                val keyManager = KeyManager(context)
                val masterKey = keyManager.getMasterKey() ?: return@run
                if (!NoteRepository.isInitialized()) {
                    NoteRepository.initialize(context, masterKey)
                }

                val dao = NoteRepository.getDatabase().noteDao()
                val note = dao.getNoteById(noteId) ?: return@run

                val lines = note.content.split("\n").toMutableList()
                if (lineIndex < 0 || lineIndex >= lines.size) return@run

                val line = lines[lineIndex]
                val toggled = when {
                    line.contains("- [ ]") -> line.replace("- [ ]", "- [x]", ignoreCase = false)
                    line.contains("- [x]") -> line.replace("- [x]", "- [ ]", ignoreCase = false)
                    else -> return@run
                }
                lines[lineIndex] = toggled

                val updatedNote = NoteEntity(
                    id = note.id,
                    title = note.title,
                    content = lines.joinToString("\n"),
                    type = note.type,
                    createdAt = note.createdAt,
                    updatedAt = System.currentTimeMillis(),
                    isPinned = note.isPinned,
                    isArchived = note.isArchived,
                    deleted = note.deleted,
                    tags = note.tags,
                    syncState = "PENDING",
                    images = note.images,
                    reminder = note.reminder,
                    recurrence = note.recurrence
                )
                dao.insertNote(updatedNote)
            } catch (e: Exception) {
                android.util.Log.e("SingleNoteWidget", "Failed to toggle checkbox", e)
            }
        }
    }

    private fun updateWidgetAppearance(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetId: Int
    ) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val noteId = prefs.getString(KEY_NOTE_ID + appWidgetId, null)

        val views = RemoteViews(context.packageName, R.layout.widget_single_note_layout)

        if (noteId == null) {
            // Unconfigured state
            views.setTextViewText(R.id.widget_note_title, "")
            views.setViewVisibility(R.id.widget_note_content, android.view.View.GONE)
            views.setViewVisibility(R.id.widget_placeholder, android.view.View.VISIBLE)

            val openAppIntent = Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            val pendingIntent = PendingIntent.getActivity(
                context, appWidgetId, openAppIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.widget_placeholder, pendingIntent)
        } else {
            var noteAvailable = true
            try {
                val keyManager = KeyManager(context)
                val masterKey = keyManager.getMasterKey()
                if (masterKey != null) {
                    if (!NoteRepository.isInitialized()) {
                        NoteRepository.initialize(context, masterKey)
                    }
                    val dao = NoteRepository.getDatabase().noteDao()
                    val note = runBlocking { dao.getNoteById(noteId) }

                    if (note == null || note.deleted) {
                        noteAvailable = false
                    } else {
                        val title = note.title.ifBlank {
                            note.content.lines().firstOrNull()?.take(60) ?: "Untitled"
                        }
                        views.setTextViewText(R.id.widget_note_title, title)
                        views.setViewVisibility(R.id.widget_placeholder, android.view.View.GONE)

                        // Set up RemoteViewsService for scrollable content
                        val serviceIntent = Intent(context, SingleNoteWidgetRemoteViewsService::class.java).apply {
                            putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId)
                            data = Uri.parse("widget://note/$appWidgetId/$noteId")
                        }
                        views.setRemoteAdapter(R.id.widget_note_content, serviceIntent)
                        views.setEmptyView(R.id.widget_note_content, R.id.widget_placeholder)
                    }
                } else {
                    noteAvailable = false
                }
            } catch (e: Exception) {
                android.util.Log.e("SingleNoteWidget", "Failed to load note", e)
                noteAvailable = false
            }

            if (!noteAvailable) {
                views.setTextViewText(R.id.widget_note_title, "Note unavailable")
                views.setViewVisibility(R.id.widget_note_content, android.view.View.GONE)
                views.setViewVisibility(R.id.widget_placeholder, android.view.View.VISIBLE)
                views.setTextViewText(R.id.widget_placeholder, "Open the app to fix this")
            }

            // Tap handler: open note editor via deep link
            val openNoteIntent = Intent(Intent.ACTION_VIEW).apply {
                data = Uri.parse("openkeep://open-note/$noteId")
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            val openNotePendingIntent = PendingIntent.getActivity(
                context, appWidgetId, openNoteIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            // Set template for the list items - captures toggle button clicks
            val toggleBaseIntent = Intent(context, SingleNoteWidget::class.java).apply {
                action = ACTION_TOGGLE_CHECKBOX
            }
            val toggleTemplatePendingIntent = PendingIntent.getBroadcast(
                context, appWidgetId, toggleBaseIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setPendingIntentTemplate(R.id.widget_note_content, toggleTemplatePendingIntent)

            // Whole widget tap opens the note
            views.setOnClickPendingIntent(R.id.widget_note_title, openNotePendingIntent)
        }

        appWidgetManager.updateAppWidget(appWidgetId, views)
    }
}