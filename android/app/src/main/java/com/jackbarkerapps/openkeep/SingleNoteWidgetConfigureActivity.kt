package com.jackbarkerapps.openkeep

import android.appwidget.AppWidgetManager
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
            SingleNoteWidget.PREFS_NAME,
            Context.MODE_PRIVATE
        )
        prefs.edit().putString(SingleNoteWidget.KEY_NOTE_ID + appWidgetId, noteId).apply()

        // Update the widget
        val appWidgetManager = AppWidgetManager.getInstance(this)
        val widget = SingleNoteWidget()
        widget.onUpdate(this, appWidgetManager, intArrayOf(appWidgetId))

        // Set result OK and finish
        val resultValue = Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId)
        setResult(RESULT_OK, resultValue)
        finish()
    }
}