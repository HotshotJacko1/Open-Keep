package com.jackbarkerapps.openkeep

import android.appwidget.AppWidgetManager
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
import androidx.glance.appwidget.lazy.itemsIndexed
import androidx.glance.appwidget.provideContent
import androidx.glance.appwidget.state.getAppWidgetState
import androidx.glance.appwidget.updateAll
import androidx.glance.background
import androidx.glance.unit.ColorProvider
import androidx.glance.layout.Alignment
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
import kotlinx.coroutines.withContext

class SingleNoteWidget : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = SingleNoteGlanceWidget()
}

class SingleNoteGlanceWidget : GlanceAppWidget() {

    /** A note and the id it was loaded for, kept together so they always match. */
    private data class LoadedNote(val noteId: String?, val note: NoteEntity?)

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val appWidgetId = GlanceAppWidgetManager(context).getAppWidgetId(id)
        // Load before composing: the content below is composed on the main thread,
        // where the old blocking read (SQLCipher open + query under runBlocking)
        // caused a Background ANR (Sentry OPENKEEP-10).
        val initialNoteId = noteIdFor(context, appWidgetId, getAppWidgetState<Preferences>(context, id))
        val initial = LoadedNote(initialNoteId, loadNote(context, initialNoteId))

        provideContent {
            val noteId = noteIdFor(context, appWidgetId, androidx.glance.currentState<Preferences>())
            // Re-pointed at another note while this session runs: load it in the
            // background, keeping the previous note on screen until it arrives.
            val loaded by produceState(initial, noteId) {
                if (value.noteId != noteId) value = LoadedNote(noteId, loadNote(context, noteId))
            }

            WidgetContent(context, loaded.note, loaded.noteId)
        }
    }

    private fun noteIdFor(context: Context, appWidgetId: Int, state: Preferences): String? =
        state[stringPreferencesKey("note_id")]
            ?: context.getSharedPreferences("single_note_widget_prefs", Context.MODE_PRIVATE)
                .getString("note_id_$appWidgetId", null)

    private suspend fun loadNote(context: Context, noteId: String?): NoteEntity? {
        if (noteId == null) return null
        return withContext(Dispatchers.IO) {
            try {
                val masterKey = KeyManager(context).getMasterKey() ?: return@withContext null
                NoteRepository.initializeIfNeeded(context, masterKey)
                NoteRepository.getDatabase().noteDao().getNoteById(noteId)?.takeIf { !it.deleted }
            } catch (e: Exception) {
                android.util.Log.e("SingleNoteWidget", "Failed to load note", e)
                null
            }
        }
    }

    override suspend fun providePreview(context: Context, widgetCategory: Int) {
        val fakeNote = NoteEntity(
            id = "preview", title = "Shopping List", content = "This is a preview\n- [ ] Milk\n- [x] Eggs",
            type = "list", createdAt = 0L, updatedAt = 0L, tags = "[]", isPinned = false,
            isArchived = false, deleted = false, syncState = "", images = "[]",
            reminder = null, recurrence = null
        )
        provideContent {
            WidgetContent(context, fakeNote, "preview")
        }
    }

    @Composable
    private fun WidgetContent(context: Context, note: NoteEntity?, noteId: String?) {
        Column(
            modifier = GlanceModifier
                .fillMaxSize()
                .appWidgetBackground()
                .background(ColorProvider(R.color.widget_background))
                .cornerRadius(16.dp)
                .padding(top = 24.dp, start = 16.dp, end = 16.dp, bottom = 16.dp)
        ) {
            if (note == null || noteId == null) {
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
                        text = if (noteId == null) "Not Configured" else "Note Unavailable",
                        style = TextStyle(fontSize = 14.sp, color = ColorProvider(R.color.widget_heading), fontWeight = FontWeight.Bold)
                    )
                    Text(
                        text = "Tap to open Open Keep",
                        style = TextStyle(fontSize = 12.sp, color = ColorProvider(R.color.widget_text_secondary))
                    )
                }
                return@Column
            }

            val title = WidgetText.displayTitle(note)
            val openNoteIntent = Intent(Intent.ACTION_VIEW).apply {
                data = Uri.parse("openkeep://open-note/$noteId")
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                component = ComponentName(context.packageName, "com.jackbarkerapps.openkeep.MainActivity")
            }

            Text(
                text = title,
                style = TextStyle(fontSize = 16.sp, fontWeight = FontWeight.Bold, color = ColorProvider(R.color.widget_heading)),
                modifier = GlanceModifier.fillMaxWidth().clickable(actionStartActivity(openNoteIntent)).padding(bottom = 8.dp)
            )

            if (WidgetText.isChecklist(note)) {
                // Line indices must stay aligned with the stored content: the toggle
                // action flips the marker on exactly this line.
                val lines = note.content.split("\n")
                val indented = ChecklistMarkdown.indentedFlags(lines)
                LazyColumn(modifier = GlanceModifier.fillMaxSize()) {
                    itemsIndexed(lines) { index, line ->
                        val item = ChecklistMarkdown.parse(line)
                        if (item != null) {
                            ChecklistItem(text = item.text, isChecked = item.isChecked, noteId = noteId, lineIndex = index, indented = indented[index])
                        } else {
                            val plain = WidgetText.plainLine(line)
                            if (plain.isNotEmpty()) BodyText(plain)
                        }
                    }
                }
            } else {
                // Text notes are stored as editor HTML - render the text, not the tags.
                val paragraphs = WidgetText.plainLines(note.content)
                LazyColumn(modifier = GlanceModifier.fillMaxSize()) {
                    items(paragraphs) { paragraph -> BodyText(paragraph) }
                }
            }
        }
    }

    @Composable
    private fun BodyText(text: String) {
        Text(
            text = text,
            style = TextStyle(fontSize = 14.sp, color = ColorProvider(R.color.widget_text_list)),
            modifier = GlanceModifier.padding(vertical = 2.dp)
        )
    }

    @Composable
    private fun ChecklistItem(text: String, isChecked: Boolean, noteId: String, lineIndex: Int, indented: Boolean) {
        val actionParamNoteId = ActionParameters.Key<String>("noteId")
        val actionParamLineIndex = ActionParameters.Key<Int>("lineIndex")
        
        // Sub-items sit one checkbox-width in, as in the app.
        Row(modifier = GlanceModifier.fillMaxWidth().padding(start = if (indented) 32.dp else 0.dp, top = 4.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Image(
                provider = ImageProvider(if (isChecked) R.drawable.ic_widget_checkbox_checked else R.drawable.ic_widget_checkbox_unchecked),
                contentDescription = null,
                modifier = GlanceModifier.size(24.dp).clickable(
                    actionRunCallback<ToggleCheckboxAction>(
                        actionParametersOf(actionParamNoteId to noteId, actionParamLineIndex to lineIndex)
                    )
                )
            )
            Spacer(modifier = GlanceModifier.width(8.dp))
            Text(
                text = text,
                style = TextStyle(fontSize = 14.sp, color = ColorProvider(if (isChecked) R.color.widget_text_checked else R.color.widget_text_list), textDecoration = if (isChecked) TextDecoration.LineThrough else TextDecoration.None)
            )
        }
    }
}

class ToggleCheckboxAction : ActionCallback {
    override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: ActionParameters) {
        val noteId = parameters[ActionParameters.Key<String>("noteId")] ?: return
        val lineIndex = parameters[ActionParameters.Key<Int>("lineIndex")] ?: return

        try {
            val keyManager = KeyManager(context)
            val masterKey = keyManager.getMasterKey() ?: return
            NoteRepository.initializeIfNeeded(context, masterKey)
            val dao = NoteRepository.getDatabase().noteDao()
            val note = dao.getNoteById(noteId) ?: return

            val lines = note.content.split("\n").toMutableList()
            if (lineIndex < 0 || lineIndex >= lines.size) return

            // Anchored + indentation-preserving, and only the marker at the start of
            // the line - never an occurrence inside the item's own text.
            val toggled = ChecklistMarkdown.toggle(lines[lineIndex]) ?: return
            lines[lineIndex] = toggled

            val updatedNote = note.copy(
                content = lines.joinToString("\n"),
                updatedAt = System.currentTimeMillis()
            )
            dao.insertNote(updatedNote)

            // Refresh every widget, not just the tapped instance: the same note can
            // appear on other Single Note widgets and on any Note Collection widget.
            SingleNoteGlanceWidget().updateAll(context)
            NoteCollectionGlanceWidget().updateAll(context)
        } catch (e: Exception) {
            android.util.Log.e("ToggleCheckboxAction", "Error", e)
        }
    }
}