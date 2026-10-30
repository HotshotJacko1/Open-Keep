package com.jackbarkerapps.openkeep

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.action.ActionParameters
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.action.ActionCallback
import androidx.glance.appwidget.action.actionRunCallback
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.action.actionParametersOf
import androidx.glance.appwidget.appWidgetBackground
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.lazy.LazyColumn
import androidx.glance.appwidget.lazy.items
import androidx.glance.appwidget.provideContent
import androidx.glance.appwidget.state.getAppWidgetState
import androidx.glance.appwidget.updateAll
import androidx.glance.background
import androidx.glance.unit.ColorProvider
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.TextDecoration
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import com.jackbarkerapps.openkeep.data.NoteEntity
import com.jackbarkerapps.openkeep.data.NoteRepository
import com.jackbarkerapps.openkeep.security.KeyManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext
import org.json.JSONArray

class NoteCollectionWidget : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = NoteCollectionGlanceWidget()
}

class NoteCollectionGlanceWidget : GlanceAppWidget() {

    /** Notes and the filter they were queried with, kept together so they always match. */
    private data class LoadedNotes(val prefs: FilterPrefs?, val notes: List<NoteEntity>?)

    companion object {
        fun getFilterPrefs(context: Context, appWidgetId: Int): FilterPrefs? {
            return NoteCollectionWidgetConfigureActivity.loadFilterPrefs(context, appWidgetId)
        }

        suspend fun queryNotes(context: Context, appWidgetId: Int): List<NoteEntity>? = withContext(Dispatchers.IO) {
            try {
                val prefs = getFilterPrefs(context, appWidgetId) ?: return@withContext emptyList()
                val keyManager = KeyManager(context)
                val masterKey = keyManager.getMasterKey() ?: return@withContext null

                NoteRepository.initializeIfNeeded(context, masterKey)
                val repo = NoteRepository(context)

                val allNotes = repo.getAllNotes().first()

                val filtered = when (prefs.type) {
                    FilterPrefs.FILTER_ALL -> allNotes.filter { !it.deleted && !it.isArchived }
                    FilterPrefs.FILTER_PINNED -> allNotes.filter { !it.deleted && !it.isArchived && it.isPinned }
                    FilterPrefs.FILTER_LABEL -> allNotes.filter { note ->
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
                    compareByDescending<NoteEntity> { it.isPinned }
                        .thenByDescending { it.updatedAt }
                )
            } catch (e: Exception) {
                null
            }
        }
    }

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val appWidgetId = GlanceAppWidgetManager(context).getAppWidgetId(id)
        // Query before composing: the content below is composed on the main thread,
        // where the old blocking query (SQLCipher open + read under runBlocking)
        // risked the ANR seen in the Single Note widget (Sentry OPENKEEP-10).
        val initialPrefs = filterPrefsFor(context, appWidgetId, getAppWidgetState<Preferences>(context, id))
        val initial = LoadedNotes(initialPrefs, queryNotes(context, appWidgetId))

        provideContent {
            val prefs = filterPrefsFor(context, appWidgetId, androidx.glance.currentState<Preferences>())
            // Filter changed while this session runs: query in the background,
            // keeping the previous list on screen until the new one arrives.
            val loaded by produceState(initial, prefs) {
                if (value.prefs != prefs) value = LoadedNotes(prefs, queryNotes(context, appWidgetId))
            }

            WidgetContent(context, loaded.prefs, loaded.notes)
        }
    }

    private fun filterPrefsFor(context: Context, appWidgetId: Int, state: Preferences): FilterPrefs? {
        val stateType = state[stringPreferencesKey("filter_type")]
        val stateValue = state[stringPreferencesKey("filter_value")] ?: ""
        return if (stateType != null) FilterPrefs(stateType, stateValue) else getFilterPrefs(context, appWidgetId)
    }

    override suspend fun providePreview(context: Context, widgetCategory: Int) {
        val fakePrefs = FilterPrefs(FilterPrefs.FILTER_ALL, "")
        val fakeNotes = listOf(
            NoteEntity(id = "1", title = "Remember", content = "Call Mum", type = "TEXT", createdAt = 0L, updatedAt = 0L, tags = "[]", isPinned = false, isArchived = false, deleted = false, syncState = "", images = "[]", reminder = null, recurrence = null),
            NoteEntity(id = "2", title = "Shopping List", content = "- [ ] Milk\n- [ ] Eggs\n- [x] Bread", type = "LIST", createdAt = 0L, updatedAt = 0L, tags = "[]", isPinned = false, isArchived = false, deleted = false, syncState = "", images = "[]", reminder = null, recurrence = null)
        )
        provideContent {
            WidgetContent(context, fakePrefs, fakeNotes)
        }
    }

    @Composable
    private fun WidgetContent(context: Context, prefs: FilterPrefs?, notes: List<NoteEntity>?) {
        Column(
            modifier = GlanceModifier
                .fillMaxSize()
                .appWidgetBackground()
                .background(ColorProvider(R.color.widget_background))
                .cornerRadius(16.dp)
                .padding(top = 24.dp, start = 16.dp, end = 16.dp, bottom = 16.dp)
        ) {
            // Header
            Row(
                modifier = GlanceModifier.fillMaxWidth().padding(bottom = 8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = prefs?.displayName() ?: "All Notes",
                    style = TextStyle(fontSize = 18.sp, fontWeight = FontWeight.Bold, color = ColorProvider(R.color.widget_heading)),
                    modifier = GlanceModifier.defaultWeight()
                )
                if (notes != null && notes.isNotEmpty()) {
                    Text(
                        text = if (notes.size == 1) "1 note" else "${notes.size} notes",
                        style = TextStyle(fontSize = 12.sp, color = ColorProvider(R.color.widget_text_count))
                    )
                }
            }

            if (prefs == null) {
                EmptyState("Tap to configure", context)
            } else if (notes == null) {
                EmptyState("Open Keep to unlock", context)
            } else if (notes.isEmpty()) {
                EmptyState("No notes found", context)
            } else {
                LazyColumn(modifier = GlanceModifier.fillMaxSize()) {
                    items(notes) { note ->
                        NoteItem(context, note)
                    }
                }
            }
        }
    }

    @Composable
    private fun EmptyState(message: String, context: Context) {
        val openAppIntent = Intent(Intent.ACTION_VIEW).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            component = ComponentName(context.packageName, "com.jackbarkerapps.openkeep.MainActivity")
        }
        Column(
            modifier = GlanceModifier.fillMaxSize().clickable(actionStartActivity(openAppIntent)),
            verticalAlignment = Alignment.CenterVertically,
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(
                text = message,
                style = TextStyle(fontSize = 14.sp, color = ColorProvider(R.color.widget_text_secondary))
            )
        }
    }

    @Composable
    private fun NoteItem(context: Context, note: NoteEntity) {
        val openNoteIntent = Intent(Intent.ACTION_VIEW).apply {
            data = Uri.parse("openkeep://open-note/${note.id}")
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            component = ComponentName(context.packageName, "com.jackbarkerapps.openkeep.MainActivity")
        }

        // Glance adds all padding together inside the background, so the gap
        // between cards has to come from this outer Box.
        Box(modifier = GlanceModifier.fillMaxWidth().padding(bottom = 8.dp)) {
            Column(
                modifier = GlanceModifier
                    .fillMaxWidth()
                    .background(ImageProvider(R.drawable.widget_note_card))
                    .padding(12.dp)
                    .clickable(actionStartActivity(openNoteIntent))
            ) {
                val title = WidgetText.displayTitle(note)
                Text(
                    text = title,
                    style = TextStyle(fontSize = 16.sp, fontWeight = FontWeight.Bold, color = ColorProvider(R.color.widget_text_primary)),
                    modifier = GlanceModifier.padding(bottom = 4.dp)
                )

                val lines = note.content.split("\n")
                val checkboxLines = mutableListOf<Triple<Int, Boolean, String>>()
                val indented = ChecklistMarkdown.indentedFlags(lines)

                for ((idx, line) in lines.withIndex()) {
                    val item = ChecklistMarkdown.parse(line) ?: continue
                    checkboxLines.add(Triple(idx, item.isChecked, item.text))
                }

                if (checkboxLines.isEmpty()) {
                    // Text notes are stored as editor HTML - show the text, not the tags.
                    val preview = WidgetText.plainLines(note.content)
                        .let { if (note.title.isBlank()) it.drop(1) else it } // first line is already the title
                        .take(3)
                        .joinToString("\n")
                    Text(
                        text = preview,
                        style = TextStyle(fontSize = 14.sp, color = ColorProvider(R.color.widget_text_secondary)),
                        maxLines = 3
                    )
                } else {
                    val visibleCount = minOf(checkboxLines.size, 3)
                    for (i in 0 until visibleCount) {
                        val (lineIdx, checked, text) = checkboxLines[i]
                        val actionParamNoteId = ActionParameters.Key<String>("noteId")
                        val actionParamLineIndex = ActionParameters.Key<Int>("lineIndex")
                    
                        Row(modifier = GlanceModifier.fillMaxWidth().padding(start = if (indented[lineIdx]) 28.dp else 0.dp, top = 2.dp, bottom = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                            Image(
                                provider = ImageProvider(if (checked) R.drawable.ic_widget_checkbox_checked else R.drawable.ic_widget_checkbox_unchecked),
                                contentDescription = null,
                                modifier = GlanceModifier.size(20.dp).clickable(
                                    actionRunCallback<CollectionToggleCheckboxAction>(
                                        actionParametersOf(actionParamNoteId to note.id, actionParamLineIndex to lineIdx)
                                    )
                                )
                            )
                            Spacer(modifier = GlanceModifier.width(8.dp))
                            Text(
                                text = text,
                                style = TextStyle(fontSize = 14.sp, color = ColorProvider(if (checked) R.color.widget_text_checked else R.color.widget_text_list), textDecoration = if (checked) TextDecoration.LineThrough else TextDecoration.None),
                                maxLines = 1
                            )
                        }
                    }
                    if (checkboxLines.size > 3) {
                        Text(
                            text = "+${checkboxLines.size - 3} more items",
                            style = TextStyle(fontSize = 12.sp, color = ColorProvider(R.color.widget_text_secondary)),
                            modifier = GlanceModifier.padding(top = 4.dp)
                        )
                    }
                }
            }
        }
    }
}

class CollectionToggleCheckboxAction : ActionCallback {
    override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: ActionParameters) {
        val noteId = parameters[ActionParameters.Key<String>("noteId")] ?: return
        val lineIndex = parameters[ActionParameters.Key<Int>("lineIndex")] ?: return

        try {
            val keyManager = KeyManager(context)
            val masterKey = keyManager.getMasterKey() ?: return

            NoteRepository.initializeIfNeeded(context, masterKey)
            val repo = NoteRepository(context)

            val notes = repo.getAllNotes().first()
            val note = notes.find { it.id == noteId } ?: return

            val lines = note.content.split("\n").toMutableList()
            if (lineIndex < 0 || lineIndex >= lines.size) return

            val toggled = ChecklistMarkdown.toggle(lines[lineIndex]) ?: return
            lines[lineIndex] = toggled

            val updatedNote = note.copy(
                content = lines.joinToString("\n"),
                updatedAt = System.currentTimeMillis()
            )
            repo.saveNote(updatedNote)

            // Refresh every widget, not just the tapped instance: the same note can
            // appear on other Note Collection widgets and on any Single Note widget.
            NoteCollectionGlanceWidget().updateAll(context)
            SingleNoteGlanceWidget().updateAll(context)
        } catch (e: Exception) {
            android.util.Log.e("ToggleCheckboxAction", "Error", e)
        }
    }
}