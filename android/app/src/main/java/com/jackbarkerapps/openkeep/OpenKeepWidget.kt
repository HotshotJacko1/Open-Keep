package com.jackbarkerapps.openkeep

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews

/**
 * 2x1 homescreen widget for Open Keep.
 * Shows two buttons side-by-side:
 *   +     -> openkeep://new-text  (new text note)
 *   [✓]   -> openkeep://new-list (new list note)
 */
class OpenKeepWidget : AppWidgetProvider() {

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray
    ) {
        for (appWidgetId in appWidgetIds) {
            updateWidgetAppearance(context, appWidgetManager, appWidgetId)
        }
    }

    private fun updateWidgetAppearance(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetId: Int
    ) {
        val views = RemoteViews(context.packageName, R.layout.widget_layout)

        // Tap handler: New Text Note
        val textIntent = Intent(Intent.ACTION_VIEW).apply {
            data = Uri.parse("openkeep://new-text")
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val textPendingIntent = PendingIntent.getActivity(
            context,
            0,
            textIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        views.setOnClickPendingIntent(R.id.widget_btn_new_text, textPendingIntent)

        // Tap handler: New List Note
        val listIntent = Intent(Intent.ACTION_VIEW).apply {
            data = Uri.parse("openkeep://new-list")
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val listPendingIntent = PendingIntent.getActivity(
            context,
            1,
            listIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        views.setOnClickPendingIntent(R.id.widget_btn_new_list, listPendingIntent)

        appWidgetManager.updateAppWidget(appWidgetId, views)
    }
}