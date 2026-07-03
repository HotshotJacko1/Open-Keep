package com.jackbarkerapps.openkeep

import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.ListView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.jackbarkerapps.openkeep.data.NoteEntity
import com.jackbarkerapps.openkeep.data.NoteRepository
import com.jackbarkerapps.openkeep.security.KeyManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking

class SingleNoteWidgetConfigureActivity : AppCompatActivity() {

    private var appWidgetId = AppWidgetManager.INVALID_APPWIDGET_ID
    private val notes = mutableListOf<NoteEntity>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.widget_configure_activity)

        // Find the widget id from the intent
        appWidgetId = intent?.getIntExtra(
            AppWidgetManager.EXTRA_APPWIDGET_ID,
            AppWidgetManager.INVALID_APPWIDGET_ID
        ) ?: AppWidgetManager.INVALID_APPWIDGET_ID

        // If widget ID is invalid, finish
        if (appWidgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
            finish()
            return
        }

        // Set result to cancelled initially
        setResult(RESULT_CANCELED)

        val listView = findViewById<ListView>(R.id.config_notes_list)
        val emptyView = findViewById<TextView>(R.id.config_empty_text)
        listView.emptyView = emptyView

        // Try to load notes
        try {
            val keyManager = KeyManager(this)
            val masterKey = keyManager.getMasterKey()

            if (masterKey == null) {
                // App hasn't been unlocked yet
                emptyView.text = "Please open Open Keep first to unlock the database"
                return
            }

            if (!NoteRepository.isInitialized()) {
                NoteRepository.initialize(this, masterKey)
            }

            CoroutineScope(Dispatchers.IO).launch {
                try {
                    val dao = NoteRepository.getDatabase().noteDao()
                    val allNotes = dao.getAllNotes().first()
                        .filter { !it.deleted }
                        .sortedByDescending { it.updatedAt }

                    runOnUiThread {
                        notes.clear()
                        notes.addAll(allNotes)

                        if (allNotes.isEmpty()) {
                            emptyView.text = "No notes yet. Create one first!"
                            return@runOnUiThread
                        }

                        val adapter = object : ArrayAdapter<NoteEntity>(
                            this@SingleNoteWidgetConfigureActivity,
                            android.R.layout.simple_list_item_2,
                            android.R.id.text1,
                            allNotes
                        ) {
                            override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
                                val view = super.getView(position, convertView, parent)
                                val note = getItem(position)
                                val text1 = view.findViewById<TextView>(android.R.id.text1)
                                val text2 = view.findViewById<TextView>(android.R.id.text2)

                                if (note != null) {
                                    val title = note.title.ifBlank {
                                        note.content.lines().firstOrNull()?.take(60) ?: "Untitled"
                                    }
                                    text1.text = title
                                    val preview = note.content.lines()
                                        .firstOrNull { it.trimStart().startsWith("-") || it.isNotBlank() }
                                        ?.take(80) ?: ""
                                    text2.text = preview
                                }
                                return view
                            }
                        }

                        listView.adapter = adapter
                    }
                } catch (e: Exception) {
                    android.util.Log.e("SingleNoteWidgetConfig", "Failed to load notes", e)
                    runOnUiThread {
                        emptyView.text = "Failed to load notes. Try again."
                    }
                }
            }
        } catch (e: Exception) {
            android.util.Log.e("SingleNoteWidgetConfig", "Config error", e)
            emptyView.text = "Error: ${e.message}"
        }

        // Handle note selection
        listView.onItemClickListener = AdapterView.OnItemClickListener { _, _, position, _ ->
            val selectedNote = notes.getOrNull(position) ?: return@OnItemClickListener
            saveNoteSelection(selectedNote.id)
        }
    }

    private fun saveNoteSelection(noteId: String) {
        val prefs = getSharedPreferences(
            "single_note_widget_prefs",
            Context.MODE_PRIVATE
        )
        android.util.Log.d("SingleNoteWidget", "Configured note $noteId for appWidgetId $appWidgetId")
        prefs.edit().putString("note_id_$appWidgetId", noteId).apply()

        CoroutineScope(Dispatchers.Main).launch {
            try {
                val glanceId = androidx.glance.appwidget.GlanceAppWidgetManager(this@SingleNoteWidgetConfigureActivity).getGlanceIdBy(appWidgetId)
                androidx.glance.appwidget.state.updateAppWidgetState(
                    context = this@SingleNoteWidgetConfigureActivity,
                    glanceId = glanceId
                ) { prefs ->
                    prefs[androidx.datastore.preferences.core.stringPreferencesKey("note_id")] = noteId
                }
                SingleNoteGlanceWidget().update(this@SingleNoteWidgetConfigureActivity, glanceId)
                android.util.Log.d("SingleNoteWidget", "Glance update successful for glanceId: $glanceId")
            } catch (e: Exception) {
                android.util.Log.e("SingleNoteWidget", "Glance update failed, falling back to broadcast", e)
                // Trigger widget update via broadcast (Glance receiver handles it)
                val updateIntent = Intent(AppWidgetManager.ACTION_APPWIDGET_UPDATE).apply {
                    component = android.content.ComponentName(this@SingleNoteWidgetConfigureActivity, SingleNoteWidget::class.java)
                    putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, intArrayOf(appWidgetId))
                }
                sendBroadcast(updateIntent)
            }

            // Set result OK and finish
            val resultValue = Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId)
            setResult(RESULT_OK, resultValue)
            finish()
        }
    }
}