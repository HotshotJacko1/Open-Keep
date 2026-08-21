package com.jackbarkerapps.openkeep

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
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
import androidx.glance.appwidget.lazy.itemsIndexed
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.color.ColorProvider
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
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import com.jackbarkerapps.openkeep.data.NoteEntity
import com.jackbarkerapps.openkeep.data.NoteRepository
import com.jackbarkerapps.openkeep.security.KeyManager
import kotlinx.coroutines.runBlocking

class SingleNoteWidget : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = SingleNoteGlanceWidget()
}

class SingleNoteGlanceWidget : GlanceAppWidget() {

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        provideContent {
            val appWidgetId = GlanceAppWidgetManager(context).getAppWidgetId(id)
            val prefsState = androidx.glance.currentState<androidx.datastore.preferences.core.Preferences>()
            var noteId = prefsState[androidx.datastore.preferences.core.stringPreferencesKey("note_id")]
            if (noteId == null) {
                val prefs = context.getSharedPreferences("single_note_widget_prefs", Context.MODE_PRIVATE)
                noteId = prefs.getString("note_id_$appWidgetId", null)
            }

            var noteEntity: NoteEntity? = null
            if (noteId != null) {
                try {
                    val keyManager = KeyManager(context)
                    val masterKey = keyManager.getMasterKey()
                    if (masterKey != null) {
                        NoteRepository.initializeIfNeeded(context, masterKey)
                        val dao = NoteRepository.getDatabase().noteDao()
                        val n = kotlinx.coroutines.runBlocking { dao.getNoteById(noteId) }
                        if (n != null && !n.deleted) {
                            noteEntity = n
                        }
                    }
                } catch (e: Exception) {
                    android.util.Log.e("SingleNoteWidget", "Failed to load note", e)
                }
            }

            WidgetContent(context, noteEntity, noteId)
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
                .background(ColorProvider(day = Color.White, night = Color(0xFF1C1C1E)))
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
                        style = TextStyle(fontSize = 14.sp, color = ColorProvider(day = Color.Black, night = Color.White), fontWeight = FontWeight.Bold)
                    )
                    Text(
                        text = "Tap to open Open Keep",
                        style = TextStyle(fontSize = 12.sp, color = ColorProvider(day = Color.Gray, night = Color.LightGray))
                    )
                }
                return@Column
            }

            val title = note.title.ifBlank { note.content.lines().firstOrNull()?.take(60) ?: "Untitled" }
            val openNoteIntent = Intent(Intent.ACTION_VIEW).apply {
                data = Uri.parse("openkeep://open-note/$noteId")
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                component = ComponentName(context.packageName, "com.jackbarkerapps.openkeep.MainActivity")
            }

            Text(
                text = title,
                style = TextStyle(fontSize = 16.sp, fontWeight = FontWeight.Bold, color = ColorProvider(day = Color.Black, night = Color.White)),
                modifier = GlanceModifier.fillMaxWidth().clickable(actionStartActivity(openNoteIntent)).padding(bottom = 8.dp)
            )

            val lines = note.content.split("\n")
            LazyColumn(modifier = GlanceModifier.fillMaxSize()) {
                itemsIndexed(lines) { index, line ->
                    val trimmed = line.trimStart()
                    when {
                        trimmed.startsWith("- [ ]") -> {
                            val text = trimmed.removePrefix("- [ ]").trim()
                            ChecklistItem(text = text, isChecked = false, noteId = noteId, lineIndex = index)
                        }
                        trimmed.startsWith("- [x]") -> {
                            val text = trimmed.removePrefix("- [x]").trim()
                            ChecklistItem(text = text, isChecked = true, noteId = noteId, lineIndex = index)
                        }
                        trimmed.isNotBlank() -> {
                            Text(
                                text = trimmed,
                                style = TextStyle(fontSize = 14.sp, color = ColorProvider(day = Color.DarkGray, night = Color.LightGray)),
                                modifier = GlanceModifier.padding(vertical = 2.dp)
                            )
                        }
                    }
                }
            }
        }
    }

    @Composable
    private fun ChecklistItem(text: String, isChecked: Boolean, noteId: String, lineIndex: Int) {
        val actionParamNoteId = ActionParameters.Key<String>("noteId")
        val actionParamLineIndex = ActionParameters.Key<Int>("lineIndex")
        
        Row(modifier = GlanceModifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Image(
                provider = ImageProvider(if (isChecked) android.R.drawable.checkbox_on_background else android.R.drawable.checkbox_off_background),
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
                style = TextStyle(fontSize = 14.sp, color = ColorProvider(day = if (isChecked) Color.Gray else Color.DarkGray, night = if (isChecked) Color(0xFF8E8E93) else Color.LightGray))
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

            val line = lines[lineIndex]
            val toggled = when {
                line.contains("- [ ]") -> line.replace("- [ ]", "- [x]", ignoreCase = false)
                line.contains("- [x]") -> line.replace("- [x]", "- [ ]", ignoreCase = false)
                else -> return
            }
            lines[lineIndex] = toggled

            val updatedNote = note.copy(
                content = lines.joinToString("\n"),
                updatedAt = System.currentTimeMillis()
            )
            dao.insertNote(updatedNote)
            
            // Force widget update
            SingleNoteGlanceWidget().update(context, glanceId)
        } catch (e: Exception) {
            android.util.Log.e("ToggleCheckboxAction", "Error", e)
        }
    }
}