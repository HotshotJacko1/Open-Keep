package com.jackbarkerapps.openkeep

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
import androidx.glance.appwidget.lazy.items
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
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.json.JSONArray

class NoteCollectionWidget : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = NoteCollectionGlanceWidget()
}

class NoteCollectionGlanceWidget : GlanceAppWidget() {

    companion object {
        fun getFilterPrefs(context: Context, appWidgetId: Int): FilterPrefs? {
            return NoteCollectionWidgetConfigureActivity.loadFilterPrefs(context, appWidgetId)
        }

        fun queryNotes(context: Context, appWidgetId: Int): List<NoteEntity>? {
            return try {
                val prefs = getFilterPrefs(context, appWidgetId) ?: return emptyList()
                val keyManager = KeyManager(context)
                val masterKey = keyManager.getMasterKey() ?: return null

                NoteRepository.initializeIfNeeded(context, masterKey)
                val repo = NoteRepository(context)

                val allNotes = runBlocking { repo.getAllNotes().first() }

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
        provideContent {
            val appWidgetId = GlanceAppWidgetManager(context).getAppWidgetId(id)
            val prefsState = androidx.glance.currentState<androidx.datastore.preferences.core.Preferences>()
            val stateType = prefsState[androidx.datastore.preferences.core.stringPreferencesKey("filter_type")]
            val stateValue = prefsState[androidx.datastore.preferences.core.stringPreferencesKey("filter_value")] ?: ""
            val prefs = if (stateType != null) FilterPrefs(stateType, stateValue) else getFilterPrefs(context, appWidgetId)
            val notes = queryNotes(context, appWidgetId)

            WidgetContent(context, prefs, notes)
        }
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
                .background(ColorProvider(day = Color.White, night = Color(0xFF1C1C1E)))
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
                    style = TextStyle(fontSize = 18.sp, fontWeight = FontWeight.Bold, color = ColorProvider(day = Color.Black, night = Color.White)),
                    modifier = GlanceModifier.defaultWeight()
                )
                if (notes != null && notes.isNotEmpty()) {
                    Text(
                        text = "${notes.size} notes",
                        style = TextStyle(fontSize = 12.sp, color = ColorProvider(day = Color.Gray, night = Color.LightGray))
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
                style = TextStyle(fontSize = 14.sp, color = ColorProvider(day = Color.DarkGray, night = Color.LightGray))
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

        Column(
            modifier = GlanceModifier
                .fillMaxWidth()
                .padding(bottom = 8.dp)
                .background(ColorProvider(day = Color(0xFFF5F5F5), night = Color(0xFF2C2C2E)))
                .padding(12.dp)
                .clickable(actionStartActivity(openNoteIntent))
        ) {
            val title = note.title.ifBlank { "Untitled" }
            Text(
                text = title,
                style = TextStyle(fontSize = 16.sp, fontWeight = FontWeight.Bold, color = ColorProvider(day = Color.Black, night = Color.White)),
                modifier = GlanceModifier.padding(bottom = 4.dp)
            )

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

            if (checkboxLines.isEmpty()) {
                val firstContentLine = lines.firstOrNull { it.trim().isNotEmpty() } ?: ""
                Text(
                    text = firstContentLine,
                    style = TextStyle(fontSize = 14.sp, color = ColorProvider(day = Color.DarkGray, night = Color.LightGray)),
                    maxLines = 3
                )
            } else {
                val visibleCount = minOf(checkboxLines.size, 3)
                for (i in 0 until visibleCount) {
                    val (lineIdx, checked, text) = checkboxLines[i]
                    val actionParamNoteId = ActionParameters.Key<String>("noteId")
                    val actionParamLineIndex = ActionParameters.Key<Int>("lineIndex")
                    
                    Row(modifier = GlanceModifier.fillMaxWidth().padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                        Image(
                            provider = ImageProvider(if (checked) android.R.drawable.checkbox_on_background else android.R.drawable.checkbox_off_background),
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
                            style = TextStyle(fontSize = 14.sp, color = ColorProvider(day = if (checked) Color.Gray else Color.DarkGray, night = if (checked) Color(0xFF8E8E93) else Color.LightGray)),
                            maxLines = 1
                        )
                    }
                }
                if (checkboxLines.size > 3) {
                    Text(
                        text = "+${checkboxLines.size - 3} more items",
                        style = TextStyle(fontSize = 12.sp, color = ColorProvider(day = Color.Gray, night = Color.LightGray)),
                        modifier = GlanceModifier.padding(top = 4.dp)
                    )
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
                
                // Force widget update
                NoteCollectionGlanceWidget().update(context, glanceId)
            }
        } catch (e: Exception) {
            android.util.Log.e("ToggleCheckboxAction", "Error", e)
        }
    }
}