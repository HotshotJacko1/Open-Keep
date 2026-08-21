package com.jackbarkerapps.openkeep

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.os.Bundle
import android.util.Log
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.ScrollView
import android.widget.TextView
import com.jackbarkerapps.openkeep.data.NoteEntity
import com.jackbarkerapps.openkeep.data.NoteRepository
import com.jackbarkerapps.openkeep.security.KeyManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.firstOrNull
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray

import androidx.appcompat.app.AppCompatActivity

/**
 * Configuration Activity for the Note Collection widget.
 * Opens automatically when the widget is added to the home screen.
 * Shows a radio list: All Notes, Pinned Notes, and each distinct user label.
 */
class NoteCollectionWidgetConfigureActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "NoteCollectionConfig"
        private const val PREFS_NAME = "note_collection_widget_prefs"
        private const val KEY_FILTER_TYPE = "filter_type"
        private const val KEY_FILTER_VALUE = "filter_value"

        fun loadFilterPrefs(context: Context, appWidgetId: Int): FilterPrefs? {
            val prefs = context.getSharedPreferences("${PREFS_NAME}_${appWidgetId}", Context.MODE_PRIVATE)
            val type = prefs.getString(KEY_FILTER_TYPE, null) ?: return null
            val value = prefs.getString(KEY_FILTER_VALUE, null) ?: ""
            return FilterPrefs(type, value)
        }

        fun saveFilterPrefs(context: Context, appWidgetId: Int, filterType: String, filterValue: String) {
            val prefs = context.getSharedPreferences("${PREFS_NAME}_${appWidgetId}", Context.MODE_PRIVATE)
            prefs.edit()
                .putString(KEY_FILTER_TYPE, filterType)
                .putString(KEY_FILTER_VALUE, filterValue)
                .apply()
        }
    }

    private lateinit var radioGroup: RadioGroup
    private lateinit var progressBar: ProgressBar
    private lateinit var contentLayout: LinearLayout
    private lateinit var saveButton: Button
    private lateinit var errorText: TextView
    private var appWidgetId: Int = AppWidgetManager.INVALID_APPWIDGET_ID
    private val scope = CoroutineScope(Dispatchers.Main)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Set result to CANCELED in case user backs out
        setResult(Activity.RESULT_CANCELED)

        appWidgetId = intent?.getIntExtra(
            AppWidgetManager.EXTRA_APPWIDGET_ID,
            AppWidgetManager.INVALID_APPWIDGET_ID
        ) ?: AppWidgetManager.INVALID_APPWIDGET_ID

        if (appWidgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
            finish()
            return
        }

        buildUI()
        loadLabels()
    }

    private fun buildUI() {
        val scrollView = ScrollView(this)
        scrollView.fitsSystemWindows = true
        scrollView.setPadding(32, 24, 32, 24)

        contentLayout = LinearLayout(this)
        contentLayout.orientation = LinearLayout.VERTICAL
        contentLayout.layoutParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        )

        // Title
        val title = TextView(this)
        title.text = "Choose notes to display"
        title.textSize = 18f
        title.setTextColor(0xFF202124.toInt())
        title.setPadding(0, 0, 0, 16)
        contentLayout.addView(title)

        // Subtitle
        val subtitle = TextView(this)
        subtitle.text = "Select a filter for this widget:"
        subtitle.textSize = 14f
        subtitle.setTextColor(0xFF5F6368.toInt())
        subtitle.setPadding(0, 0, 0, 20)
        contentLayout.addView(subtitle)

        // Progress bar
        progressBar = ProgressBar(this, null, android.R.attr.progressBarStyleSmall)
        progressBar.layoutParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { gravity = android.view.Gravity.CENTER }
        contentLayout.addView(progressBar)

        // Error text (hidden initially)
        errorText = TextView(this)
        errorText.textSize = 13f
        errorText.setTextColor(0xFFD93025.toInt())
        errorText.setPadding(0, 12, 0, 12)
        errorText.visibility = android.view.View.GONE
        contentLayout.addView(errorText)

        // Radio group
        radioGroup = RadioGroup(this)
        radioGroup.layoutParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        )

        // Add "All Notes" option
        addRadioOption(FilterPrefs.FILTER_ALL, "All Notes", "Show all non-archived notes", 0)
        // Add "Pinned Notes" option
        addRadioOption(FilterPrefs.FILTER_PINNED, "Pinned Notes", "Show only pinned notes", 1)

        contentLayout.addView(radioGroup)

        // Labels section header (shown after labels load)
        val labelHeader = TextView(this)
        labelHeader.text = "By Label"
        labelHeader.textSize = 14f
        labelHeader.setTextColor(0xFF202124.toInt())
        labelHeader.typeface = android.graphics.Typeface.DEFAULT_BOLD
        labelHeader.setPadding(0, 16, 0, 8)
        labelHeader.id = android.R.id.edit // reuse existing ID for reference
        labelHeader.visibility = android.view.View.GONE
        contentLayout.addView(labelHeader)

        // Save button
        saveButton = Button(this)
        saveButton.text = "Save"
        saveButton.isEnabled = false
        saveButton.setPadding(0, 24, 0, 0)
        saveButton.setOnClickListener {
            val selectedId = radioGroup.checkedRadioButtonId
            if (selectedId != -1) {
                val radioBtn = findViewById<RadioButton>(selectedId)
                val tag = radioBtn.tag as? String ?: return@setOnClickListener
                val value = radioBtn.text.toString()
                saveFilterAndFinish(tag, value)
            }
        }
        contentLayout.addView(saveButton)

        scrollView.addView(contentLayout)
        setContentView(scrollView)
    }

    private fun addRadioOption(tag: String, label: String, description: String?, id: Int) {
        val radioBtn = RadioButton(this)
        radioBtn.id = id
        radioBtn.text = label
        radioBtn.tag = tag
        radioBtn.setTextColor(0xFF202124.toInt())
        radioBtn.textSize = 16f
        radioBtn.setPadding(16, 12, 16, 12)
        if (description != null) {
            radioBtn.contentDescription = description
        }
        radioGroup.addView(radioBtn)
    }

    private fun loadLabels() {
        scope.launch {
            try {
                val labels = withContext(Dispatchers.IO) { fetchLabels() }
                populateLabelOptions(labels)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to load labels", e)
                errorText.text = "Could not load labels: ${e.message}"
                errorText.visibility = android.view.View.GONE
                // Still allow selection of All/Pinned
                progressBar.visibility = android.view.View.GONE
                saveButton.isEnabled = true
            }
        }
    }

    private suspend fun fetchLabels(): List<String> {
        val keyManager = KeyManager(applicationContext)
        val masterKey = keyManager.getMasterKey()
            ?: throw IllegalStateException("No master key available")

        if (!NoteRepository.isInitialized()) {
            NoteRepository.initialize(applicationContext, masterKey)
        }
        val repo = NoteRepository(applicationContext)

        // Collect all notes to extract unique tags
        val notes = repo.getAllNotes().firstOrNull() ?: emptyList()

        val tagSet = mutableSetOf<String>()
        for (note in notes) {
            if (note.deleted || note.isArchived) continue
            try {
                val tagsArray = JSONArray(note.tags)
                for (i in 0 until tagsArray.length()) {
                    tagSet.add(tagsArray.getString(i))
                }
            } catch (e: Exception) {
                // Skip malformed tags
            }
        }

        return tagSet.sorted()
    }

    private fun populateLabelOptions(tagLabels: List<String>) {
        progressBar.visibility = android.view.View.GONE

        val labelHeader = findViewById<TextView>(android.R.id.edit)
        if (tagLabels.isNotEmpty()) {
            labelHeader.visibility = android.view.View.VISIBLE
            // Add a separator
            val separator = View(this)
            separator.layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, 1
            ).apply { setMargins(0, 8, 0, 8) }
            separator.setBackgroundColor(0xFFE0E0E0.toInt())
            contentLayout.addView(separator, contentLayout.indexOfChild(labelHeader) + 1)

            // Create a sub-RadioGroup for labels so they share selection with main group
            // Actually, we need all options in one RadioGroup for exclusive selection
            // So we add them to radioGroup
            var index = 2
            for (label in tagLabels) {
                val radioBtn = RadioButton(this)
                radioBtn.id = index
                radioBtn.text = label
                radioBtn.tag = FilterPrefs.FILTER_LABEL
                radioBtn.setTextColor(0xFF202124.toInt())
                radioBtn.textSize = 16f
                radioBtn.setPadding(32, 12, 16, 12)
                radioGroup.addView(radioBtn)
                index++
            }
        } else {
            labelHeader.visibility = android.view.View.GONE
        }

        // Select "All Notes" by default
        if (radioGroup.childCount > 0) {
            radioGroup.check(0)
        }

        saveButton.isEnabled = true
    }

    private fun saveFilterAndFinish(filterType: String, filterValue: String) {
        saveFilterPrefs(this, appWidgetId, filterType, filterValue)

        scope.launch {
            try {
                val glanceId = androidx.glance.appwidget.GlanceAppWidgetManager(this@NoteCollectionWidgetConfigureActivity).getGlanceIdBy(appWidgetId)
                androidx.glance.appwidget.state.updateAppWidgetState(
                    context = this@NoteCollectionWidgetConfigureActivity,
                    glanceId = glanceId
                ) { prefs ->
                    prefs[androidx.datastore.preferences.core.stringPreferencesKey("filter_type")] = filterType
                    prefs[androidx.datastore.preferences.core.stringPreferencesKey("filter_value")] = filterValue
                }
                NoteCollectionGlanceWidget().update(this@NoteCollectionWidgetConfigureActivity, glanceId)
            } catch (e: Exception) {
                val intent = Intent(this@NoteCollectionWidgetConfigureActivity, NoteCollectionWidget::class.java).apply {
                    action = AppWidgetManager.ACTION_APPWIDGET_UPDATE
                    putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, intArrayOf(appWidgetId))
                }
                sendBroadcast(intent)
            }

            val resultValue = Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId)
            setResult(Activity.RESULT_OK, resultValue)
            finish()
        }
    }

    /** A simple invisible View used for separators */
    private class View(context: Context) : android.view.View(context)
}