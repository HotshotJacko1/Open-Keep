package com.jackbarkerapps.openkeep

import android.app.Activity
import android.content.Context
import android.content.res.ColorStateList
import android.content.res.Configuration
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat

/**
 * Shared look for the widget setup screens (Note Collection and Single Note).
 * Colours come from res/values/widget_colors.xml and its values-night twin, so
 * these screens follow the phone's light/dark mode like the widgets do.
 */
object WidgetConfigStyle {

    /** Dark status and navigation bar icons on the light page, light icons on the dark one. */
    fun applySystemBars(activity: Activity) {
        val night = (activity.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
            Configuration.UI_MODE_NIGHT_YES
        WindowCompat.getInsetsController(activity.window, activity.window.decorView).apply {
            isAppearanceLightStatusBars = !night
            isAppearanceLightNavigationBars = !night
        }
    }

    /** Radio buttons: the app's amber when selected, muted otherwise. */
    fun radioTint(context: Context): ColorStateList = ColorStateList(
        arrayOf(intArrayOf(android.R.attr.state_checked), intArrayOf()),
        intArrayOf(
            ContextCompat.getColor(context, R.color.widget_config_accent),
            ContextCompat.getColor(context, R.color.widget_checkbox)
        )
    )

    fun dp(context: Context, value: Int): Int =
        (value * context.resources.displayMetrics.density).toInt()
}
