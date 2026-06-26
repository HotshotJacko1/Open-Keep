package com.jackbarkerapps.openkeep

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Build
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import com.jackbarkerapps.openkeep.data.NoteRepository
import com.jackbarkerapps.openkeep.security.KeyManager
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.json.JSONArray

/**
 * 4×3 homescreen widget that displays a scrollable list of notes from the
 * encrypted database, filtered by the user's configuration.
 *
 * Tapping a note deep-links into the editor; tapping a checkbox row sends a
 * broadcast that toggles the checkbox inline (brief visual delay is acceptable).
 */
class NoteCollectionWidget : AppWidgetProvider() {

    companion object {
        private const val TAG = "NoteCollectionWidget"
        const val ACTION_TOGGLE_CHECKBOX = "com.jackbarkerapps.openkeep.TOGGLE_CHECKBOX"
        const val EXTRA_NOTE_ID = "note_id"
        const val EXTRA_LINE_INDEX = "line_index"
        const val EXTRA_APPWIDGET_ID = "appwidget_id"

        private fun getFilterPrefs(context: Context, appWidgetId: Int): FilterPrefs? {
            return NoteCollectionWidgetConfigureActivity.loadFilterPrefs(context, appWidgetId)
        }

        fun queryNotes(context: Context, appWidgetId: Int): List<com.jackbarkerapps.openkeep.data.NoteEntity>? {
            return try {
                val prefs = getFilterPrefs(context, appWidgetId) ?: return emptyList()
                val keyManager = KeyManager(context)
                val masterKey = keyManager.getMasterKey() ?: return null

                NoteRepository.reset()
                NoteRepository.initialize(context, masterKey)
                val repo = NoteRepository(context)

                val allNotes = runBlocking { repo.getAllNotes().first() }
                NoteRepository.reset()

                val filtered = when (prefs.type) {
                    FilterPrefs.FILTER_ALL ->
                        allNotes.filter { !it.deleted && !it.isArchived }
                    FilterPrefs.FILTER_PINNED ->
                        allNotes.filter { !it.deleted && !it.isArchived && it.isPinned }
                    FilterPrefs.FILTER_LABEL ->
                        allNotes.filter { note ->
                            if (note.deleted || note.isArchived) return@filter false
                            try {
                                val tagsArray = JSONArray(note.tags)
                                for (i in 0 until tagsArray.length()) {
                                    if (tagsArray.getString(i) == prefs.value) return@filter true
                                }
                            } catch (_: Exception) {}
                            false
                        }
                    else -> emptyList()
                }

                filtered.sortedWith(
                    compareByDescending<com.jackbarkerapps.openkeep.data.NoteEntity> { it.isPinned }
                        .thenByDescending { it.updatedAt }
                )
            } catch (e: Exception) {
                android.util.Log.e(TAG, "Failed to query notes", e)
                null
            }
        }

        fun toggleCheckboxInNote(context: Context, noteId: String, lineIndex: Int) {
            try {
                val keyManager = KeyManager(context)
                val masterKey = keyManager.getMasterKey() ?: return

                NoteRepository.reset()
                NoteRepository.initialize(context, masterKey)
                val repo = NoteRepository(context)

                val notes = runBlocking { repo.getAllNotes().first() }
                val note = notes.find { it.id == noteId } ?: return

                val lines = note.content.split("\n").toMutableList()
                if (lineIndex < 0 || lineIndex >= lines.size) return

                val line = lines[lineIndex]
                val checkboxRegex = Regex("^(\\s*)-\\s\\[([ xX])\\]\\s(.*)$")
                val match = checkboxRegex.find(line)
                if (match != null) {
                    val indent = match.groupValues[1]
                    val checked = match.groupValues[2].lowercase() == "x"
                    val text = match.groupValues[3]
                    lines[lineIndex] = "${indent}- [${if (checked) " " else "x"}] $text"
                    val newContent = lines.joinToString("\n")

                    val updatedNote = note.copy(
                        content = newContent,
                        updatedAt = System.currentTimeMillis()
                    )
                    runBlocking { repo.saveNote(updatedNote) }
                }

                NoteRepository.reset()
            } catch (e: Exception) {
                android.util.Log.e(TAG, "Failed to toggle checkbox", e)
            }
        }

        fun refreshWidget(context: Context, appWidgetIds: IntArray) {
            val appWidgetManager = AppWidgetManager.getInstance(context)
            for (appWidgetId in appWidgetIds) {
                updateWidgetAppearance(context, appWidgetManager, appWidgetId)
            }
        }

        private fun updateWidgetAppearance(
            context: Context,
            appWidgetManager: AppWidgetManager,
            appWidgetId: Int
        ) {
            val prefs = getFilterPrefs(context, appWidgetId)
            if (prefs == null) {
                val views = RemoteViews(context.packageName, R.layout.note_collection_widget_layout)
                views.setTextViewText(R.id.widget_title, "Note Collection")
                views.setViewVisibility(R.id.widget_note_list, android.view.View.GONE)
                views.setViewVisibility(R.id.widget_empty_state, android.view.View.VISIBLE)
                views.setTextViewText(R.id.widget_empty_state, "Tap to configure")
                views.setTextViewText(R.id.widget_note_count, "")
                appWidgetManager.updateAppWidget(appWidgetId, views)
                return
            }

            val testKey = KeyManager(context).getMasterKey()
            if (testKey == null) {
                val views = RemoteViews(context.packageName, R.layout.note_collection_widget_layout)
                views.setTextViewText(R.id.widget_title, prefs.displayName())
                views.setViewVisibility(R.id.widget_note_list, android.view.View.GONE)
                views.setViewVisibility(R.id.widget_empty_state, android.view.View.GONE)
                views.setViewVisibility(R.id.widget_locked_state, android.view.View.VISIBLE)
                views.setTextViewText(R.id.widget_note_count, "")
                appWidgetManager.updateAppWidget(appWidgetId, views)
                return
            }

            val intent = Intent(context, NoteCollectionWidgetService::class.java).apply {
                putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId)
                data = Uri.parse(toUri(Intent.URI_INTENT_SCHEME).toString() + "#" + appWidgetId)
            }

            val views = RemoteViews(context.packageName, R.layout.note_collection_widget_layout)
            views.setTextViewText(R.id.widget_title, prefs.displayName())

            val notes = queryNotes(context, appWidgetId)
            val noteCount = notes?.size ?: 0

            if (noteCount == 0) {
                views.setViewVisibility(R.id.widget_note_list, android.view.View.GONE)
                views.setViewVisibility(R.id.widget_locked_state, android.view.View.GONE)
                views.setViewVisibility(R.id.widget_empty_state, android.view.View.VISIBLE)
                views.setTextViewText(
                    R.id.widget_empty_state,
                    if (notes == null) "Open Keep to unlock" else "No notes found"
                )
                views.setTextViewText(R.id.widget_note_count, "")
            } else {
                views.setViewVisibility(R.id.widget_note_list, android.view.View.VISIBLE)
                views.setViewVisibility(R.id.widget_empty_state, android.view.View.GONE)
                views.setViewVisibility(R.id.widget_locked_state, android.view.View.GONE)
                views.setTextViewText(R.id.widget_note_count, "${noteCount} notes")
                views.setRemoteAdapter(R.id.widget_note_list, intent)

                val tapIntent = Intent(Intent.ACTION_VIEW).apply {
                    data = Uri.parse("openkeep://open-note/PLACEHOLDER")
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                }
                val tapPendingIntent = PendingIntent.getActivity(
                    context,
                    appWidgetId,
                    tapIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )
                views.setPendingIntentTemplate(R.id.widget_note_list, tapPendingIntent)
            }

            appWidgetManager.updateAppWidget(appWidgetId, views)
        }
    }

    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        for (appWidgetId in appWidgetIds) {
            updateWidgetAppearance(context, appWidgetManager, appWidgetId)
        }
        super.onUpdate(context, appWidgetManager, appWidgetIds)
    }

    @SuppressLint("UnspecifiedRegisterReceiverFlag")
        override fun onEnabled(context: Context) {
            super.onEnabled(context)
            val filter = IntentFilter(ACTION_TOGGLE_CHECKBOX)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.registerReceiver(checkboxToggleReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
            } else {
                context.registerReceiver(checkboxToggleReceiver, filter)
            }
        }

    override fun onDisabled(context: Context) {
        super.onDisabled(context)
        try { context.unregisterReceiver(checkboxToggleReceiver) } catch (_: Exception) {}
    }

    private val checkboxToggleReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action != ACTION_TOGGLE_CHECKBOX) return

            val noteId = intent.getStringExtra(EXTRA_NOTE_ID)
            val lineIndex = intent.getIntExtra(EXTRA_LINE_INDEX, -1)
            val appWidgetId = intent.getIntExtra(EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)

            if (noteId == null || lineIndex < 0) return

            toggleCheckboxInNote(context, noteId, lineIndex)

            if (appWidgetId != AppWidgetManager.INVALID_APPWIDGET_ID) {
                updateWidgetAppearance(context, AppWidgetManager.getInstance(context), appWidgetId)
            } else {
                val appWidgetManager = AppWidgetManager.getInstance(context)
                val componentName = ComponentName(context, NoteCollectionWidget::class.java)
                val ids = appWidgetManager.getAppWidgetIds(componentName)
                for (id in ids) {
                    updateWidgetAppearance(context, appWidgetManager, id)
                }
            }
        }
    }
}

// -----------------------------------------------------------------------------
// RemoteViewsService + RemoteViewsFactory
// -----------------------------------------------------------------------------

class NoteCollectionWidgetService : RemoteViewsService() {
    override fun onGetViewFactory(intent: Intent): RemoteViewsService.RemoteViewsFactory {
        val appWidgetId = intent.getIntExtra(
            AppWidgetManager.EXTRA_APPWIDGET_ID,
            AppWidgetManager.INVALID_APPWIDGET_ID
        )
        return NoteCollectionViewsFactory(applicationContext, appWidgetId)
    }
}

class NoteCollectionViewsFactory(
    private val context: Context,
    private val appWidgetId: Int
) : RemoteViewsService.RemoteViewsFactory {

    private var notes: List<com.jackbarkerapps.openkeep.data.NoteEntity> = emptyList()

    override fun onCreate() { loadNotes() }
    override fun onDataSetChanged() { loadNotes() }

    private fun loadNotes() {
        notes = NoteCollectionWidget.queryNotes(context, appWidgetId) ?: emptyList()
    }

    override fun getCount(): Int = notes.size
    override fun getItemId(position: Int): Long = position.toLong()
    override fun hasStableIds(): Boolean = false
    override fun getLoadingView(): RemoteViews? = null
    override fun getViewTypeCount(): Int = 1
    override fun onDestroy() {}

    override fun getViewAt(position: Int): RemoteViews {
        val note = notes.getOrNull(position)
            ?: return RemoteViews(context.packageName, R.layout.note_collection_widget_item)

        val itemViews = RemoteViews(context.packageName, R.layout.note_collection_widget_item)

        // Title
        itemViews.setTextViewText(R.id.widget_note_title, note.title.ifBlank { "Untitled" })

        val lines = note.content.split("\n")
        val checkboxRegex = Regex("^\\s*-\\s\\[([ xX])\\]\\s(.*)$")
        val checkboxLines = mutableListOf<Triple<Int, Boolean, String>>()

        for ((idx, line) in lines.withIndex()) {
            val match = checkboxRegex.find(line)
            if (match != null) {
                val checked = match.groupValues[1].lowercase() == "x"
                val text = match.groupValues[2]
                checkboxLines.add(Triple(idx, checked, text))
            }
        }

        val firstContentLine = lines.firstOrNull { line ->
            line.trim().isNotEmpty() && !checkboxRegex.containsMatchIn(line)
        }

        if (checkboxLines.isEmpty()) {
            // Plain text note — show content preview
            itemViews.setViewVisibility(R.id.widget_note_content, android.view.View.VISIBLE)
            itemViews.setTextViewText(R.id.widget_note_content, firstContentLine ?: "")
            for (i in 1..3) {
                itemViews.setViewVisibility(checkboxRowId(i), android.view.View.GONE)
            }
            itemViews.setViewVisibility(R.id.widget_more_items, android.view.View.GONE)

            val fillIntent = Intent().apply {
                data = Uri.parse("openkeep://open-note/${note.id}")
            }
            itemViews.setOnClickFillInIntent(R.id.widget_note_item_root, fillIntent)
        } else {
            // Checklist note — show up to 3 checkbox items
            itemViews.setViewVisibility(R.id.widget_note_content, android.view.View.GONE)

            val visibleCount = minOf(checkboxLines.size, 3)
            for (i in 0 until visibleCount) {
                val (lineIdx, checked, text) = checkboxLines[i]
                val rowId = checkboxRowId(i + 1)
                val iconId = checkboxIconId(i + 1)
                val textId = checkboxTextId(i + 1)

                itemViews.setViewVisibility(rowId, android.view.View.VISIBLE)
                itemViews.setImageViewResource(
                    iconId,
                    if (checked) R.drawable.ic_checkbox_checked else R.drawable.ic_checkbox_unchecked
                )
                itemViews.setTextViewText(textId, text)

                val toggleIntent = Intent(NoteCollectionWidget.ACTION_TOGGLE_CHECKBOX).apply {
                    putExtra(NoteCollectionWidget.EXTRA_NOTE_ID, note.id)
                    putExtra(NoteCollectionWidget.EXTRA_LINE_INDEX, lineIdx)
                    putExtra(NoteCollectionWidget.EXTRA_APPWIDGET_ID, appWidgetId)
                }
                val togglePendingIntent = PendingIntent.getBroadcast(
                    context,
                    ("cb_${note.id}_$lineIdx").hashCode(),
                    toggleIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )
                itemViews.setOnClickPendingIntent(rowId, togglePendingIntent)
            }

            // Hide remaining empty slots
            for (i in visibleCount until 3) {
                itemViews.setViewVisibility(checkboxRowId(i + 1), android.view.View.GONE)
            }

            if (checkboxLines.size > 3) {
                itemViews.setViewVisibility(R.id.widget_more_items, android.view.View.VISIBLE)
                itemViews.setTextViewText(R.id.widget_more_items, "+${checkboxLines.size - 3} more items")
            } else {
                itemViews.setViewVisibility(R.id.widget_more_items, android.view.View.GONE)
            }

            val fillIntent = Intent().apply {
                data = Uri.parse("openkeep://open-note/${note.id}")
            }
            itemViews.setOnClickFillInIntent(R.id.widget_note_item_root, fillIntent)
        }

        return itemViews
    }

    private fun checkboxRowId(slot: Int): Int = when (slot) {
        1 -> R.id.widget_checkbox_row_1
        2 -> R.id.widget_checkbox_row_2
        3 -> R.id.widget_checkbox_row_3
        else -> R.id.widget_checkbox_row_1
    }

    private fun checkboxIconId(slot: Int): Int = when (slot) {
        1 -> R.id.widget_checkbox_icon_1
        2 -> R.id.widget_checkbox_icon_2
        3 -> R.id.widget_checkbox_icon_3
        else -> R.id.widget_checkbox_icon_1
    }

    private fun checkboxTextId(slot: Int): Int = when (slot) {
        1 -> R.id.widget_checkbox_text_1
        2 -> R.id.widget_checkbox_text_2
        3 -> R.id.widget_checkbox_text_3
        else -> R.id.widget_checkbox_text_1
    }
}