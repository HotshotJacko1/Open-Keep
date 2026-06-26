package com.jackbarkerapps.openkeep

/**
 * Represents the user's filter choice for a Note Collection widget instance.
 * Saved to SharedPreferences per appWidgetId.
 */
data class FilterPrefs(
    val type: String,
    val value: String
) {
    companion object {
        const val FILTER_ALL = "all"
        const val FILTER_PINNED = "pinned"
        const val FILTER_LABEL = "label"
    }

    fun displayName(): String = when (type) {
        FILTER_ALL -> "All Notes"
        FILTER_PINNED -> "Pinned Notes"
        FILTER_LABEL -> "Label: $value"
        else -> "All Notes"
    }
}