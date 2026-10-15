package cn.firelink.app

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner

private data class Delivery(val id: Int, val title: String, val body: String)

/** Local transport for development auth. Content only comes from the mock-enabled server. */
@Composable
fun rememberAuthNotification(): (Int, String, String) -> Unit {
    val strings = localizedResources()
    val context = LocalContext.current
    val owner = LocalLifecycleOwner.current
    val manager = remember { context.getSystemService(NotificationManager::class.java) }
    var pending by remember { mutableStateOf<List<Delivery>>(emptyList()) }
    var showSettings by remember { mutableStateOf(false) }
    val channel = "account_messages"
    fun enabled(): Boolean =
        manager.areNotificationsEnabled() &&
            manager.getNotificationChannel(channel)?.importance !=
                NotificationManager.IMPORTANCE_NONE
    fun deliver() {
        if (!enabled()) return
        pending.forEach { message ->
            val intent =
                Intent(context, MainActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            val contentIntent =
                PendingIntent.getActivity(
                    context,
                    0,
                    intent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                )
            manager.notify(
                message.id,
                Notification.Builder(context, channel)
                    .setSmallIcon(R.drawable.ic_firelink)
                    .setContentTitle(message.title)
                    .setContentText(message.body)
                    .setStyle(Notification.BigTextStyle().bigText(message.body))
                    .setContentIntent(contentIntent)
                    .setCategory(Notification.CATEGORY_MESSAGE)
                    .setVisibility(Notification.VISIBILITY_PRIVATE)
                    .setTimeoutAfter(300000)
                    .setAutoCancel(true)
                    .build(),
            )
        }
        pending = emptyList()
        showSettings = false
    }
    val permission =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted) deliver() else showSettings = true
        }
    DisposableEffect(owner) {
        manager.createNotificationChannel(
            NotificationChannel(
                channel,
                strings.getString(R.string.account_messages),
                NotificationManager.IMPORTANCE_HIGH,
            )
        )
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) deliver()
        }
        owner.lifecycle.addObserver(observer)
        onDispose { owner.lifecycle.removeObserver(observer) }
    }
    if (showSettings)
        AlertDialog(
            onDismissRequest = { showSettings = false },
            title = { Text(strings.getString(R.string.enable_notifications)) },
            text = { Text(strings.getString(R.string.notification_permission)) },
            confirmButton = {
                TextButton(
                    onClick = {
                        context.startActivity(
                            Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                                .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
                        )
                    }
                ) {
                    Text(strings.getString(R.string.open_settings))
                }
            },
            dismissButton = {
                TextButton(onClick = { showSettings = false }) {
                    Text(strings.getString(R.string.cancel))
                }
            },
        )
    return { id, title, body ->
        pending = pending.filterNot { it.id == id } + Delivery(id, title, body)
        if (enabled()) deliver()
        else if (
            Build.VERSION.SDK_INT >= 33 &&
                context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) !=
                    android.content.pm.PackageManager.PERMISSION_GRANTED
        )
            permission.launch(Manifest.permission.POST_NOTIFICATIONS)
        else showSettings = true
    }
}
