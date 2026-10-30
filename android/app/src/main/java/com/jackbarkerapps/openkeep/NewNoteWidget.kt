package com.jackbarkerapps.openkeep

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.appWidgetBackground
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.unit.ColorProvider
import androidx.glance.layout.Alignment
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxHeight
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.layout.width
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.text.FontWeight

class NewNoteWidget : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = NewNoteGlanceWidget()
}

class NewNoteGlanceWidget : GlanceAppWidget() {
    override suspend fun provideGlance(context: Context, id: GlanceId) {
        provideContent {
            WidgetContent(context)
        }
    }

    override suspend fun providePreview(context: Context, widgetCategory: Int) {
        provideContent {
            WidgetContent(context)
        }
    }

    @Composable
    private fun WidgetContent(context: Context) {
        val textIntent = Intent(Intent.ACTION_VIEW).apply {
            data = Uri.parse("openkeep://new-text")
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            component = ComponentName(context.packageName, "com.jackbarkerapps.openkeep.MainActivity")
        }

        val listIntent = Intent(Intent.ACTION_VIEW).apply {
            data = Uri.parse("openkeep://new-list")
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            component = ComponentName(context.packageName, "com.jackbarkerapps.openkeep.MainActivity")
        }

        Row(
            modifier = GlanceModifier
                .fillMaxSize()
                .appWidgetBackground()
                .background(ColorProvider(R.color.widget_background))
                .cornerRadius(16.dp)
                .padding(0.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Left Button
            Column(
                modifier = GlanceModifier
                    .defaultWeight()
                    .fillMaxHeight()
                    .clickable(actionStartActivity(textIntent))
                    .padding(8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Image(
                    provider = ImageProvider(R.drawable.ic_widget_plus),
                    contentDescription = "New text note",
                    modifier = GlanceModifier.size(32.dp)
                )
                Text(
                    text = "New Note",
                    style = TextStyle(
                        fontSize = 11.sp,
                        color = ColorProvider(R.color.widget_label),
                        fontWeight = FontWeight.Medium
                    ),
                    modifier = GlanceModifier.padding(top = 4.dp)
                )
            }

            // Divider
            Spacer(
                modifier = GlanceModifier
                    .width(1.dp)
                    .fillMaxHeight()
                    .background(ColorProvider(R.color.widget_divider))
            )

            // Right Button
            Column(
                modifier = GlanceModifier
                    .defaultWeight()
                    .fillMaxHeight()
                    .clickable(actionStartActivity(listIntent))
                    .padding(8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Image(
                    provider = ImageProvider(R.drawable.ic_widget_checkbox),
                    contentDescription = "New list note",
                    modifier = GlanceModifier.size(32.dp)
                )
                Text(
                    text = "New List",
                    style = TextStyle(
                        fontSize = 11.sp,
                        color = ColorProvider(R.color.widget_label),
                        fontWeight = FontWeight.Medium
                    ),
                    modifier = GlanceModifier.padding(top = 4.dp)
                )
            }
        }
    }
}