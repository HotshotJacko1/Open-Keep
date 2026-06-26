package com.jackbarkerapps.openkeep

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.util.Log
import android.view.View
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import com.jackbarkerapps.openkeep.data.NoteEntity
import com.jackbarkerapps.openkeep.data.NoteRepository
import com.jackbarkerapps.openkeep.security.KeyManager
import org.json.JSONArray

/**
 * 4x3 homescreen widget that displays a scrollable list of notes from the
 * encrypted database, filtered by the user's configuration (All, Pinned, or a Label).
 *
 * Supports:
 * - Tapping a note → deep-link into the note editor (openkeep://open-note/{id})
 * - Tapping a checkbox → inline toggle via broadcast + DB update
 */
class NoteCollectionWidget : AppWidgetProvider() {

    companion object {
        private const val TAG = "NoteCollectionWidget"
        private const val ACTION_TOGGLE_CHECKBOX = "com.jackbarkerapps.openkeep.TOGGLE_CHECKBOX"
        private const val EXTRA_NOTE_ID = "note_id"
        private const val EXTRA_LINE_INDEX = "line_index"
        private const val EXTRA_APPWIDGET_ID = "appwidget_id"

        /**
         * Read filter preferences saved by the config Activity.
         */
        private fun getFilterPrefs(context: Context, appWidgetId: Int): NoteCollectionWidgetConfigureActivity.FilterPrefs? {
            return NoteCollectionWidgetConfigureActivity.loadFilterPrefs(context, appWidgetId)
        }

        /**
         * Try to initialize the database and query notes matching the filter.
         * Returns null if the DB is locked / key unavailable.
         */
        fun queryNotes(context: Context, appWidgetId: Int): List<NoteEntity>? {
            return try {
                val prefs = getFilterPrefs(context, appWidgetId) ?: return emptyList()
                val keyManager = KeyManager(context)
                val masterKey = keyManager.getMasterKey()
                    ?: return null // DB locked

                NoteRepository.reset()
                NoteRepository.initialize(context, masterKey)
                val repo = NoteRepository(context)

                val allNotes = kotlinx.coroutines.flow.firstOrNull(repo.getAllNotes()) ?: emptyList()
                NoteRepository.reset()

                // Apply filter
                val filtered = when (prefs.type) {
                    NoteCollectionWidgetConfigureActivity.FILTER_ALL -> {
                        allNotes.filter { !it.deleted && !it.isArchived }
                    }
                    NoteCollectionWidgetConfigureActivity.FILTER_PINNED -> {
                        allNotes.filter { !it.deleted && !it.isArchived && it.isPinned }
                    }
                    NoteCollectionWidgetConfigureActivity.FILTER_LABEL -> {
                        allNotes.filter { note ->
                            if (note.deleted || note.isArchived) return@filter false
                            try {
                                val tagsArray = JSONArray(note.tags)
                                for (i in 0 until tagsArray.length()) {
                                    if (tagsArray.getString(i) == prefs.value) return@filter true
                                }
                            } catch (e: Exception) {}
                            false
                        }
                    }
                    else -> emptyList()
                }

                // Sort: pinned first, then by updatedAt desc
                filtered.sortedWith(
                    compareByDescending<NoteEntity> { it.isPinned }
                        .thenByDescending { it.updatedAt }
                )
            } catch (e: Exception) {
                Log.e(TAG, "Failed to query notes", e)
                null
            }
        }

        /**
         * Toggle a checkbox in a note's content at the given line index.
         */
        fun toggleCheckboxInNote(context: Context, noteId: String, lineIndex: Int): Boolean {
            return try {
                val keyManager = KeyManager(context)
                val masterKey = keyManager.getMasterKey() ?: return false

                NoteRepository.reset()
                NoteRepository.initialize(context, masterKey)
                val repo = NoteRepository(context)

                val notes = kotlinx.coroutines.flow.firstOrNull(repo.getAllNotes()) ?: emptyList()
                val note = notes.find { it.id == noteId } ?: return false

                val lines = note.content.split("\n").toMutableList()
                if (lineIndex < 0 || lineIndex >= lines.size) return false

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
                    repo.saveNote(updatedNote)
                }

                NoteRepository.reset()
                true
            } catch (e: Exception) {
                Log.e(TAG, "Failed to toggle checkbox", e)
                false
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
                // Not configured yet — show placeholder
                val views = RemoteViews(context.packageName, R.layout.note_collection_widget_layout)
                views.setTextViewText(R.id.widget_title, "Note Collection")
                views.setViewVisibility(R.id.widget_note_list, View.GONE)
                views.setViewVisibility(R.id.widget_empty_state, View.VISIBLE)
                views.setTextViewText(R.id.widget_empty_state, "Tap to configure")
                views.setTextViewText(R.id.widget_note_count, "")
                appWidgetManager.updateAppWidget(appWidgetId, views)
                return
            }

            // Check if DB is accessible
            val testKey = KeyManager(context).getMasterKey()
            if (testKey == null) {
                val views = RemoteViews(context.packageName, R.layout.note_collection_widget_layout)
                views.setTextViewText(R.id.widget_title, prefs.displayName())
                views.setViewVisibility(R.id.widget_note_list, View.GONE)
                views.setViewVisibility(R.id.widget_empty_state, View.GONE)
                views.setViewVisibility(R.id.widget_locked_state, View.VISIBLE)
                views.setTextViewText(R.id.widget_note_count, "")
                appWidgetManager.updateAppWidget(appWidgetId, views)
                return
            }

            // Set up the list via RemoteViewsService
            val intent = Intent(context, NoteCollectionWidgetService::class.java).apply {
                putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId)
                data = Uri.parse(toUri(Intent.URI_INTENT_SCHEME).toString() + "#" + appWidgetId)
            }

            val views = RemoteViews(context.packageName, R.layout.note_collection_widget_layout)
            views.setTextViewText(R.id.widget_title, prefs.displayName())

            // Query notes to get count
            val notes = queryNotes(context, appWidgetId)
            val noteCount = notes?.size ?: 0

            if (noteCount == 0) {
                views.setViewVisibility(R.id.widget_note_list, View.GONE)
                views.setViewVisibility(R.id.widget_locked_state, View.GONE)
                views.setViewVisibility(R.id.widget_empty_state, View.VISIBLE)
                views.setTextViewText(
                    R.id.widget_empty_state,
                    if (notes == null) "Open Keep to unlock" else "No notes found"
                )
                views.setTextViewText(R.id.widget_note_count, "")
            } else {
                views.setViewVisibility(R.id.widget_note_list, View.VISIBLE)
                views.setViewVisibility(R.id.widget_empty_state, View.GONE)
                views.setViewVisibility(R.id.widget_locked_state, View.GONE)
                views.setTextViewText(R.id.widget_note_count, "${noteCount} notes")
                views.setRemoteAdapter(R.id.widget_note_list, intent)

                // Set the pending intent template for tapping a note
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

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray
    ) {
        for (appWidgetId in appWidgetIds) {
            updateWidgetAppearance(context, appWidgetManager, appWidgetId)
        }
        super.onUpdate(context, appWidgetManager, appWidgetIds)
    }

    override fun onEnabled(context: Context) {
        super.onEnabled(context)
        val filter = IntentFilter(ACTION_TOGGLE_CHECKBOX)
        context.registerReceiver(checkboxToggleReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
    }

    override fun onDisabled(context: Context) {
        super.onDisabled(context)
        try {
            context.unregisterReceiver(checkboxToggleReceiver)
        } catch (e: Exception) {}
    }

    private val checkboxToggleReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action != ACTION_TOGGLE_CHECKBOX) return

            val noteId = intent.getStringExtra(EXTRA_NOTE_ID)
            val lineIndex = intent.getIntExtra(EXTRA_LINE_INDEX, -1)
            val appWidgetId = intent.getIntExtra(EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)

            if (noteId == null || lineIndex < 0) return

            toggleCheckboxInNote(context, noteId, lineIndex)

            // Refresh the widget
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
    override fun onGetViewFactory(intent: Intent): RemoteViewsFactory {
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
) : RemoteViewsFactory {

    private var notes: List<NoteEntity> = emptyList()

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

        // --- Title ---
        itemViews.setTextViewText(R.id.widget_note_title, note.title.ifBlank { "Untitled" })

        // Parse content for checkboxes
        val lines = note.content.split("\n")
        val checkboxRegex = Regex("^\\s*-\\s\\[([ xX])\\]\\s(.*)$")
        val checkboxLines = mutableListOf<Triple<Int, Boolean, String>>() // (lineIndex, checked, text)

        for ((idx, line) in lines.withIndex()) {
            val match = checkboxRegex.find(line)
            if (match != null) {
                val checked = match.groupValues[1].lowercase() == "x"
                val text = match.groupValues[2]
                checkboxLines.add(Triple(idx, checked, text))
            }
        }

        // Get first non-checkbox line for content preview
        val firstContentLine = lines.firstOrNull { line ->
            line.trim().isNotEmpty() && !checkboxRegex.containsMatchIn(line)
        }

        if (checkboxLines.isEmpty()) {
            // --- Plain text note (no checkboxes) ---
            itemViews.setViewVisibility(R.id.widget_note_content, View.VISIBLE)
            itemViews.setTextViewText(R.id.widget_note_content, firstContentLine ?: "")
            hideAllCheckboxRows(itemViews)
            itemViews.setViewVisibility(R.id.widget_more_items, View.GONE)

            // Open-note fillInIntent on the root
            val fillIntent = Intent().apply {
                data = Uri.parse("openkeep://open-note/${note.id}")
            }
            itemViews.setOnClickFillInIntent(R.id.widget_note_item_root, fillIntent)

        } else {
            // --- Checkbox note ---
            itemViews.setViewVisibility(R.id.widget_note_content, View.GONE)

            // Show up to 3 checkbox rows
            val visibleCount = minOf(checkboxLines.size, 3)
            for (i in 0 until visibleCount) {
                val (lineIdx, checked, text) = checkboxLines[i]
                val rowId = checkboxRowId(i + 1)
                val iconId = checkboxIconId(i + 1)
                val textId = checkboxTextId(i + 1)

                itemViews.setViewVisibility(rowId, View.VISIBLE)
                itemViews.setImageViewResource(
                    iconId,
                    if (checked) R.drawable.ic_checkbox_checked else R.drawable.ic_checkbox_unchecked
                )
                itemViews.setTextViewText(textId, text)

                // Fill-in intent for tapping this checkbox row
                val toggleIntent = Intent(ACTION_TOGGLE_CHECKBOX).apply {
                    putExtra(EXTRA_NOTE_ID, note.id)
                    putExtra(EXTRA_LINE_INDEX, lineIdx)
                    putExtra(EXTRA_APPWIDGET_ID, appWidgetId)
                }
                val togglePendingIntent = PendingIntent.getBroadcast(
                    context,
                    ("cb_${note.id}_$lineIdx").hashCode(),
                    toggleIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )
                itemViews.setOnClickPendingIntent(rowId, togglePendingIntent)
            }

            // Hide remaining checkbox slots
            for (i in visibleCount until 3) {
                itemViews.setViewVisibility(checkboxRowId(i + 1), View.GONE)
            }

            // "More items" indicator
            if (checkboxLines.size > 3) {
                itemViews.setViewVisibility(R.id.widget_more_items, View.VISIBLE)
                itemViews.setTextViewText(
                    R.id.widget_more_items,
                    "+${checkboxLines.size - 3} more items"
                )
            } else {
                itemViews.setViewVisibility(R.id.widget_more_items, View.GONE)
            }

            // Open-note fillInIntent on the root (for tapping the title area)
            val fillIntent = Intent().apply {
                data = Uri.parse("openkeep://open-note/${note.id}")
            }
            itemViews.setOnClickFillInIntent(R.id.widget_note_item_root, fillIntent)
        }

        return itemViews
    }

    private fun hideAllCheckboxRows(views: RemoteViews) {
        for (i in 1..3) {
            views.setViewVisibility(checkboxRowId(i), View.GONE)
        }
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