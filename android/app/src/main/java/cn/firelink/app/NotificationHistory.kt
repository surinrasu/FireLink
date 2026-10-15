package cn.firelink.app

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

@Composable
fun NotificationHistoryScreen(model: AppModel, go: (String) -> Unit, login: () -> Unit) {
    val strings = localizedResources()
    var loading by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf(false) }
    var opening by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    suspend fun reload() {
        loading = true
        failed = false
        try {
            model.refreshNotifications()
        } catch (e: Exception) {
            failed = true
            model.report(e)
        } finally {
            loading = false
        }
    }
    LaunchedEffect(model.profile?.id) { if (model.profile != null) reload() }
    if (model.profile == null) {
        Page {
            EmptyState(
                strings.getString(R.string.notifications_sign_in),
                strings.getString(R.string.notifications_sign_in_hint),
            )
            Button(onClick = login) { Text(strings.getString(R.string.sign_in_register)) }
        }
        return
    }
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        item {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                TextButton(enabled = !loading, onClick = { scope.launch { reload() } }) {
                    Icon(Icons.Outlined.Refresh, null)
                    Spacer(Modifier.width(6.dp))
                    Text(
                        if (loading) strings.getString(R.string.refreshing)
                        else strings.getString(R.string.refresh)
                    )
                }
            }
        }
        if (loading && model.notifications.isEmpty()) item { CircularProgressIndicator() }
        if (!loading && model.notifications.isEmpty())
            item {
                if (failed)
                    EmptyState(
                        strings.getString(R.string.notifications_failed),
                        strings.getString(R.string.tap_refresh_retry),
                    )
                else
                    EmptyState(
                        strings.getString(R.string.no_notifications),
                        strings.getString(R.string.no_notifications_hint),
                    )
            }
        items(model.notifications, key = { it.id }) { notice ->
            Card(
                onClick = {
                    scope.launch {
                        opening = notice.id
                        try {
                            model.markNotificationRead(notice.id)
                            if (notice.applicationId != null) go("history")
                        } catch (e: Exception) {
                            model.report(e)
                        } finally {
                            opening = null
                        }
                    }
                },
                enabled = opening == null,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Icon(
                            Icons.Outlined.Notifications,
                            null,
                            tint = MaterialTheme.colorScheme.primary,
                        )
                        Text(
                            notice.title,
                            Modifier.weight(1f),
                            fontWeight =
                                if (notice.readAt == null) FontWeight.Bold else FontWeight.Medium,
                        )
                        if (notice.readAt == null)
                            Text(
                                strings.getString(R.string.unread),
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.primary,
                            )
                    }
                    Text(notice.body)
                    Text(
                        displayTime(notice.createdAt),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    if (notice.applicationId != null)
                        Text(
                            strings.getString(R.string.view_applications),
                            style = MaterialTheme.typography.labelLarge,
                            color = MaterialTheme.colorScheme.primary,
                        )
                }
            }
        }
    }
}
