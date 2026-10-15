package cn.firelink.app

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OrganizerContactsSheet(organizer: Organizer, dismiss: () -> Unit) {
    val strings = localizedResources()
    val context = LocalContext.current
    var copied by remember { mutableStateOf<String?>(null) }
    var failure by remember { mutableStateOf<String?>(null) }
    ModalBottomSheet(onDismissRequest = dismiss) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(
                strings.getString(R.string.contact_organizer),
                style = MaterialTheme.typography.headlineSmall,
            )
            Text(organizer.name, style = MaterialTheme.typography.titleMedium)
            organizer.contacts.forEach { contact ->
                Card(Modifier.fillMaxWidth()) {
                    Column(
                        Modifier.padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text(contact.label, style = MaterialTheme.typography.labelLarge)
                        Text(contact.value, style = MaterialTheme.typography.bodyLarge)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            if (contact.type in listOf("phone", "email"))
                                TextButton(
                                    onClick = {
                                        val intent =
                                            if (contact.type == "phone")
                                                Intent(
                                                    Intent.ACTION_DIAL,
                                                    Uri.fromParts("tel", contact.value, null),
                                                )
                                            else
                                                Intent(
                                                    Intent.ACTION_SENDTO,
                                                    Uri.fromParts("mailto", contact.value, null),
                                                )
                                        runCatching { context.startActivity(intent) }
                                            .onFailure {
                                                failure = strings.getString(R.string.no_contact_app)
                                            }
                                    }
                                ) {
                                    Icon(
                                        if (contact.type == "phone") Icons.Outlined.Call
                                        else Icons.Outlined.Email,
                                        null,
                                    )
                                    Spacer(Modifier.width(6.dp))
                                    Text(
                                        if (contact.type == "phone")
                                            strings.getString(R.string.call_phone)
                                        else strings.getString(R.string.send_email)
                                    )
                                }
                            TextButton(
                                onClick = {
                                    context
                                        .getSystemService(ClipboardManager::class.java)
                                        .setPrimaryClip(
                                            ClipData.newPlainText(contact.label, contact.value)
                                        )
                                    copied = contact.value
                                }
                            ) {
                                Text(
                                    if (copied == contact.value) strings.getString(R.string.copied)
                                    else if (contact.type == "wechat")
                                        strings.getString(R.string.copy_wechat)
                                    else strings.getString(R.string.copy)
                                )
                            }
                        }
                    }
                }
            }
            failure?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        }
    }
}
