package com.jackbarkerapps.openkeep

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.res.ColorStateList
import android.graphics.Typeface
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
import androidx.core.content.ContextCompat

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
    private var allNotesOptionId: Int = android.view.View.NO_ID
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

    private fun color(id: Int): Int = ContextCompat.getColor(this, id)

    private fun dp(value: Int): Int = WidgetConfigStyle.dp(this, value)

    private val mediumTypeface: Typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)

    private fun buildUI() {
        // The page colour comes from Theme.OpenKeep.WidgetConfigure (see AndroidManifest.xml).
        WidgetConfigStyle.applySystemBars(this)

        // fitsSystemWindows replaces the ScrollView's own padding with the system bar
        // insets, so the page margins go on the content inside it.
        val scrollView = ScrollView(this)
        scrollView.fitsSystemWindows = true

        contentLayout = LinearLayout(this)
        contentLayout.orientation = LinearLayout.VERTICAL
        contentLayout.layoutParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        )
        contentLayout.setPadding(dp(20), dp(16), dp(20), dp(16))

        // Title
        val title = TextView(this)
        title.text = "Choose notes to display"
        title.textSize = 22f
        title.typeface = mediumTypeface
        title.setTextColor(color(R.color.widget_heading))
        title.setPadding(0, 0, 0, dp(4))
        contentLayout.addView(title)

        // Subtitle
        val subtitle = TextView(this)
        subtitle.text = "Select a filter for this widget:"
        subtitle.textSize = 14f
        subtitle.setTextColor(color(R.color.widget_text_secondary))
        subtitle.setPadding(0, 0, 0, dp(16))
        contentLayout.addView(subtitle)

        // Progress bar
        progressBar = ProgressBar(this, null, android.R.attr.progressBarStyleSmall)
        progressBar.indeterminateTintList = ColorStateList.valueOf(color(R.color.widget_config_accent))
        progressBar.layoutParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply {
            gravity = android.view.Gravity.CENTER
            bottomMargin = dp(12)
        }
        contentLayout.addView(progressBar)

        // Error text (hidden initially)
        errorText = TextView(this)
        errorText.textSize = 13f
        errorText.setTextColor(color(R.color.widget_config_error))
        errorText.setPadding(0, 0, 0, dp(12))
        errorText.visibility = android.view.View.GONE
        contentLayout.addView(errorText)

        // Radio group, drawn as one of the app's note cards
        radioGroup = RadioGroup(this)
        radioGroup.layoutParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        )
        radioGroup.setBackgroundResource(R.drawable.widget_note_card)
        radioGroup.setPadding(dp(8), dp(4), dp(12), dp(4))

        // Add "All Notes" option
        allNotesOptionId = addRadioOption(FilterPrefs.FILTER_ALL, "All Notes", "Show all non-archived notes")
        // Add "Pinned Notes" option
        addRadioOption(FilterPrefs.FILTER_PINNED, "Pinned Notes", "Show only pinned notes")

        contentLayout.addView(radioGroup)

        // Save button: a pill in the colour of the app's + button
        saveButton = Button(this)
        saveButton.text = "Save"
        saveButton.isAllCaps = false
        saveButton.textSize = 16f
        saveButton.typeface = mediumTypeface
        saveButton.setTextColor(ContextCompat.getColorStateList(this, R.color.widget_config_button_text_color))
        saveButton.setBackgroundResource(R.drawable.widget_config_button)
        saveButton.stateListAnimator = null
        saveButton.minHeight = dp(48)
        saveButton.minimumHeight = dp(48)
        saveButton.layoutParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { topMargin = dp(20) }
        saveButton.isEnabled = false
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

    private fun addRadioOption(tag: String, label: String, description: String?): Int {
        val radioBtn = styledRadioButton(tag, label)
        if (description != null) {
            radioBtn.contentDescription = description
        }
        radioGroup.addView(radioBtn)
        return radioBtn.id
    }

    private fun styledRadioButton(tag: String, label: String): RadioButton {
        val radioBtn = RadioButton(this)
        radioBtn.id = android.view.View.generateViewId()
        radioBtn.text = label
        radioBtn.tag = tag
        radioBtn.setTextColor(color(R.color.widget_heading))
        radioBtn.buttonTintList = WidgetConfigStyle.radioTint(this)
        radioBtn.textSize = 16f
        radioBtn.minHeight = dp(48)
        radioBtn.setPadding(dp(8), dp(8), dp(8), dp(8))
        return radioBtn
    }

    private fun loadLabels() {
        scope.launch {
            try {
                val labels = withContext(Dispatchers.IO) { fetchLabels() }
                populateLabelOptions(labels)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to load labels", e)
                errorText.text = if (e is IllegalStateException) {
                    "Open the Open Keep app once to unlock your notes, then add this widget again to filter by label."
                } else {
                    "Could not load labels: ${e.message}"
                }
                errorText.visibility = android.view.View.VISIBLE
                // Still allow selection of All/Pinned
                progressBar.visibility = android.view.View.GONE
                radioGroup.check(allNotesOptionId)
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

        if (tagLabels.isNotEmpty()) {
            // Header, divider and label options all go INSIDE the RadioGroup, after
            // "Pinned Notes": the group must own every option for exclusive selection,
            // and anything added to contentLayout instead ends up below the labels.
            val separator = View(this)
            separator.layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(1)
            ).apply { setMargins(dp(4), dp(8), 0, dp(4)) }
            separator.setBackgroundColor(color(R.color.widget_divider))
            radioGroup.addView(separator)

            val labelHeader = TextView(this)
            labelHeader.text = "By Label"
            labelHeader.textSize = 14f
            labelHeader.setTextColor(color(R.color.widget_text_secondary))
            labelHeader.typeface = mediumTypeface
            labelHeader.setPadding(dp(4), dp(8), 0, dp(4))
            radioGroup.addView(labelHeader)

            for (label in tagLabels) {
                radioGroup.addView(styledRadioButton(FilterPrefs.FILTER_LABEL, label))
            }
        }

        // Select "All Notes" by default
        radioGroup.check(allNotesOptionId)

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