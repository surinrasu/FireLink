package cn.firelink.app

import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*

@Composable
fun LoginScreen(model: AppModel, demoDone: () -> Unit, done: () -> Unit) {
    val strings = localizedResources()
    var phone by rememberSaveable { mutableStateOf("") }
    var code by rememberSaveable { mutableStateOf("") }
    var challenge by rememberSaveable(stateSaver = jsonSaver<SMSResult?>()) {
        mutableStateOf<SMSResult?>(null)
    }
    var registration by rememberSaveable { mutableStateOf<String?>(null) }
    var realName by rememberSaveable { mutableStateOf("") }
    var idNumber by rememberSaveable { mutableStateOf("") }
    var consent by rememberSaveable { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    fun perform(action: suspend () -> Unit) {
        busy = true
        failure = null
        scope.launch {
            try {
                action()
            } catch (e: Exception) {
                failure = e.message
            } finally {
                busy = false
            }
        }
    }
    val notify = rememberAuthNotification()
    LaunchedEffect(registration) {
        if (registration != null)
            model.config?.mockIdentity?.let {
                notify(
                    1002,
                    strings.getString(R.string.identity_information),
                    strings.getString(R.string.identity_notification, it.realName, it.idNumber),
                )
            }
    }
    Page {
        Text(
            "FireLink",
            style = MaterialTheme.typography.headlineLarge,
            fontWeight = FontWeight.Bold,
            letterSpacing = (-0.04).em,
        )
        Text(
            if (registration == null) strings.getString(R.string.welcome)
            else strings.getString(R.string.create_profile),
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.Bold,
        )
        if (registration != null) {
            SectionTitle(strings.getString(R.string.phone_not_registered))
            EditField(strings.getString(R.string.real_name), realName) { realName = it }
            EditField(strings.getString(R.string.id_number), idNumber) { idNumber = it.uppercase() }
            CheckRow(strings.getString(R.string.registration_consent), consent) { consent = it }
            Button(
                enabled = consent && realName.isNotBlank() && idNumber.length == 18 && !busy,
                onClick = {
                    perform {
                        val result: AuthResult =
                            model.api.post(
                                "/v1/auth/register",
                                buildJsonObject {
                                    put("registrationToken", registration)
                                    put("realName", realName)
                                    put("idNumber", idNumber)
                                    put("consent", true)
                                },
                            )
                        model.accept(result)
                        done()
                    }
                },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(strings.getString(R.string.register_verify))
            }
        } else {
            OutlinedTextField(
                phone,
                { phone = it },
                label = { Text(strings.getString(R.string.mainland_phone)) },
                prefix = { Text("+86 ") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                enabled = challenge == null,
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
            )
            if (challenge == null) {
                Button(
                    enabled = phone.isNotBlank() && !busy,
                    onClick = {
                        perform {
                            challenge =
                                model.api.post(
                                    "/v1/auth/sms",
                                    buildJsonObject { put("phone", phone) },
                                )
                            challenge?.mockCode?.let {
                                notify(
                                    1001,
                                    strings.getString(R.string.code_notification_title),
                                    strings.getString(R.string.code_notification_body, it),
                                )
                            }
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(strings.getString(R.string.request_code))
                }
                PasskeyLoginOption(model, enabled = !busy, done = done) { failure = it }
                if (model.config?.demo == true) {
                    OutlinedButton(
                        enabled = !busy,
                        onClick = {
                            perform {
                                model.enterDemo()
                                demoDone()
                            }
                        },
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(strings.getString(R.string.enter_demo_client))
                    }
                }
            } else {
                OutlinedTextField(
                    code,
                    { code = it },
                    label = { Text(strings.getString(R.string.verification_code)) },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                )
                Button(
                    enabled = !busy,
                    onClick = {
                        perform {
                            val result: AuthResult =
                                model.api.post(
                                    "/v1/auth/verify",
                                    buildJsonObject {
                                        put("challengeId", challenge!!.challengeId)
                                        put("code", code)
                                    },
                                )
                            if (result.registrationToken != null)
                                registration = result.registrationToken
                            else {
                                model.accept(result)
                                done()
                            }
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(strings.getString(R.string.verify_continue))
                }
                TextButton(
                    enabled = !busy,
                    onClick = {
                        challenge = null
                        code = ""
                    },
                ) {
                    Text(strings.getString(R.string.resend_change_phone))
                }
            }
        }
        failure?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        if (busy) CircularProgressIndicator()
    }
}

@Composable
fun AccountScreen(model: AppModel, go: (String) -> Unit, login: () -> Unit) {
    val strings = localizedResources()
    Page {
        model.profile?.let { p ->
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(18.dp),
            ) {
                Icon(
                    Icons.Outlined.AccountCircle,
                    null,
                    Modifier.size(64.dp),
                    tint = MaterialTheme.colorScheme.primary,
                )
                Column {
                    Text(p.username, style = MaterialTheme.typography.headlineMedium)
                    Text(
                        strings.getString(R.string.identity_verified),
                        style = MaterialTheme.typography.labelMedium,
                    )
                }
            }
            NavigationRow(
                strings.getString(R.string.profile),
                strings.getString(R.string.profile_summary),
            ) {
                go("edit")
            }
            NavigationRow(
                strings.getString(R.string.qualifications),
                strings.getString(R.string.qualifications_summary),
            ) {
                go("skills")
            }
            NavigationRow(
                strings.getString(R.string.application_history),
                strings.getString(R.string.applications_summary),
            ) {
                go("history")
            }
            val unreadCount = model.notifications.count { it.readAt == null }
            NavigationRow(
                strings.getString(R.string.notification_history),
                if (unreadCount > 0)
                    strings.getString(R.string.unread_notification_count, unreadCount)
                else strings.getString(R.string.notifications_summary),
            ) {
                go("notifications")
            }
        }
            ?: run {
                Text(strings.getString(R.string.account_sign_in_hint))
                Button(onClick = login) { Text(strings.getString(R.string.sign_in_register)) }
            }
        NavigationRow(
            strings.getString(R.string.settings),
            strings.getString(R.string.settings_summary),
        ) {
            go("settings")
        }
    }
}

@Composable
fun NavigationRow(title: String, description: String, onClick: () -> Unit) {
    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        colors =
            CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
    ) {
        Row(Modifier.padding(20.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(title, style = MaterialTheme.typography.titleMedium)
                Text(
                    description,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Icon(Icons.Outlined.ChevronRight, null)
        }
    }
}

@Composable
fun ProfileScreen(model: AppModel, initial: Profile) {
    val strings = localizedResources()
    var p by rememberSaveable(initial.id, stateSaver = jsonSaver<Profile>()) {
        mutableStateOf(
            initial.copy(
                equipmentDescription =
                    initial.equipmentText { key ->
                        legacyEquipmentLabels[key]?.let(strings::getString) ?: key
                    }
            )
        )
    }
    var verify by rememberSaveable { mutableStateOf(false) }
    var realName by rememberSaveable { mutableStateOf("") }
    var idNumber by rememberSaveable { mutableStateOf("") }
    var verifying by remember { mutableStateOf(false) }
    var verifyError by remember { mutableStateOf<String?>(null) }
    val notify = rememberAuthNotification()
    var busy by remember { mutableStateOf(false) }
    var saved by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    Page {
        SectionTitle(strings.getString(R.string.public_name))
        EditField(strings.getString(R.string.username), p.username) {
            p = p.copy(username = it)
            saved = false
        }
        EditField(strings.getString(R.string.optional_pronouns), p.pronouns) {
            p = p.copy(pronouns = it)
            saved = false
        }
        SectionTitle(strings.getString(R.string.region))
        RegionPicker(p.region) {
            p = p.copy(region = it)
            saved = false
        }
        Text(
            strings.getString(R.string.region_example_hint),
            style = MaterialTheme.typography.bodySmall,
        )
        SectionTitle(strings.getString(R.string.vehicles))
        vehicleLabels.forEach { (key, label) ->
            val count = p.vehicles[key] ?: 0
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(strings.getString(label), Modifier.weight(1f))
                IconButton(
                    enabled = count > 0,
                    onClick = {
                        p = p.copy(vehicles = p.vehicles + (key to (count - 1)))
                        saved = false
                    },
                ) {
                    Icon(
                        Icons.Outlined.Remove,
                        strings.getString(R.string.vehicle_decrease, strings.getString(label)),
                    )
                }
                Text(
                    count.toString(),
                    modifier = Modifier.widthIn(min = 30.dp),
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                )
                IconButton(
                    enabled = count < 999,
                    onClick = {
                        p = p.copy(vehicles = p.vehicles + (key to (count + 1)))
                        saved = false
                    },
                ) {
                    Icon(
                        Icons.Outlined.Add,
                        strings.getString(R.string.vehicle_increase, strings.getString(label)),
                    )
                }
            }
        }
        SectionTitle(strings.getString(R.string.equipment))
        OutlinedTextField(
            value = p.equipmentDescription.orEmpty(),
            onValueChange = {
                p = p.copy(equipmentDescription = it)
                saved = false
            },
            placeholder = { Text(strings.getString(R.string.equipment_text_hint)) },
            modifier = Modifier.fillMaxWidth(),
            minLines = 4,
            maxLines = 8,
        )
        SectionTitle(strings.getString(R.string.identity_information))
        InfoRow(strings.getString(R.string.real_name), p.realName)
        InfoRow(strings.getString(R.string.age), strings.getString(R.string.age_years, p.age))
        InfoRow(strings.getString(R.string.gender), strings.genderLabel(p.gender))
        TextButton(
            onClick = {
                realName = ""
                idNumber = ""
                verifyError = null
                verify = true
                model.config?.mockIdentity?.let {
                    notify(
                        1002,
                        strings.getString(R.string.identity_information),
                        strings.getString(R.string.identity_notification, it.realName, it.idNumber),
                    )
                }
            }
        ) {
            Text(strings.getString(R.string.reverify_identity))
        }
        SectionTitle(strings.getString(R.string.contact_details))
        EditField(strings.getString(R.string.contact_phone), p.contacts.phone, KeyboardType.Phone) {
            p = p.copy(contacts = p.contacts.copy(phone = it))
            saved = false
        }
        EditField(strings.getString(R.string.optional_wechat), p.contacts.wechat) {
            p = p.copy(contacts = p.contacts.copy(wechat = it))
            saved = false
        }
        EditField(
            strings.getString(R.string.optional_email),
            p.contacts.email,
            KeyboardType.Email,
        ) {
            p = p.copy(contacts = p.contacts.copy(email = it))
            saved = false
        }
        Text(
            strings.getString(R.string.contacts_consent_hint),
            style = MaterialTheme.typography.bodySmall,
        )
        Button(
            enabled = !busy,
            onClick = {
                scope.launch {
                    busy = true
                    saved = false
                    try {
                        model.saveProfile(p)
                        saved = true
                    } catch (e: Exception) {
                        model.report(e)
                    } finally {
                        busy = false
                    }
                }
            },
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(
                if (busy) strings.getString(R.string.saving)
                else strings.getString(R.string.save_profile)
            )
        }
        if (saved)
            Text(strings.getString(R.string.saved), color = MaterialTheme.colorScheme.secondary)
    }
    if (verify)
        AlertDialog(
            onDismissRequest = { if (!verifying) verify = false },
            title = { Text(strings.getString(R.string.reverify_identity)) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    EditField(strings.getString(R.string.real_name), realName) { realName = it }
                    EditField(strings.getString(R.string.id_number), idNumber) {
                        idNumber = it.uppercase()
                    }
                    verifyError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                }
            },
            confirmButton = {
                TextButton(
                    enabled = !verifying && realName.isNotBlank() && idNumber.length == 18,
                    onClick = {
                        scope.launch {
                            verifying = true
                            try {
                                val result = model.reverify(realName, idNumber)
                                p =
                                    p.copy(
                                        realName = result.realName,
                                        birthDate = result.birthDate,
                                        gender = result.gender,
                                    )
                                verify = false
                            } catch (e: Exception) {
                                verifyError = e.message
                            } finally {
                                verifying = false
                            }
                        }
                    },
                ) {
                    Text(
                        if (verifying) strings.getString(R.string.verifying_identity)
                        else strings.getString(R.string.confirm_verification)
                    )
                }
            },
            dismissButton = {
                TextButton(enabled = !verifying, onClick = { verify = false }) {
                    Text(strings.getString(R.string.cancel))
                }
            },
        )
}

@Composable
fun EditField(
    label: String,
    value: String,
    keyboard: KeyboardType = KeyboardType.Text,
    onChange: (String) -> Unit,
) {
    OutlinedTextField(
        value,
        onChange,
        label = { Text(label) },
        keyboardOptions = KeyboardOptions(keyboardType = keyboard),
        modifier = Modifier.fillMaxWidth(),
        singleLine = true,
    )
}

@Composable
fun InfoRow(label: String, value: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value)
    }
}

@Composable
fun SkillsScreen(model: AppModel) {
    val strings = localizedResources()
    var credentials by remember { mutableStateOf<List<Credential>>(emptyList()) }
    var title by rememberSaveable { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) {
        try {
            credentials = model.api.get("/v1/credentials")
        } catch (e: Exception) {
            model.report(e)
        }
    }
    val picker =
        rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
            if (uri != null)
                scope.launch {
                    busy = true
                    try {
                        val payload =
                            withContext(Dispatchers.IO) {
                                val resolver = context.contentResolver
                                val mime = resolver.getType(uri) ?: "application/octet-stream"
                                val name =
                                    resolver.query(uri, null, null, null, null)?.use {
                                        if (it.moveToFirst())
                                            it.getString(
                                                it.getColumnIndexOrThrow(
                                                    OpenableColumns.DISPLAY_NAME
                                                )
                                            )
                                        else "certificate"
                                    } ?: "certificate"
                                val bytes =
                                    resolver.openInputStream(uri)?.use { input ->
                                        val output = java.io.ByteArrayOutputStream()
                                        val buffer = ByteArray(8192)
                                        while (true) {
                                            val count = input.read(buffer)
                                            if (count < 0) break
                                            if (output.size() + count > 8 * 1024 * 1024)
                                                throw ServiceException(
                                                    strings.getString(R.string.attachment_too_large)
                                                )
                                            output.write(buffer, 0, count)
                                        }
                                        output.toByteArray()
                                    }
                                        ?: throw ServiceException(
                                            strings.getString(R.string.file_read_failed)
                                        )
                                Triple(bytes, mime, name)
                            }
                        model.upload(payload.first, payload.second, payload.third, title)
                        title = ""
                        credentials = model.api.get("/v1/credentials")
                    } catch (e: Exception) {
                        model.report(e)
                    } finally {
                        busy = false
                    }
                }
        }
    Page {
        SectionTitle(strings.getString(R.string.add_certificate))
        EditField(strings.getString(R.string.certificate_name), title) { title = it }
        Button(
            enabled = title.isNotBlank() && !busy,
            onClick = { picker.launch(arrayOf("application/pdf", "image/jpeg", "image/png")) },
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(
                if (busy) strings.getString(R.string.uploading)
                else strings.getString(R.string.choose_upload)
            )
        }
        Text(strings.getString(R.string.upload_hint), style = MaterialTheme.typography.bodySmall)
        SectionTitle(strings.getString(R.string.my_qualifications))
        credentials.forEach {
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(it.title, fontWeight = FontWeight.Bold)
                    Text(it.filename, style = MaterialTheme.typography.bodySmall)
                    Text(
                        if (it.status == "uploaded") strings.getString(R.string.uploaded_unverified)
                        else strings.getString(R.string.verified),
                        style = MaterialTheme.typography.labelMedium,
                    )
                }
            }
        }
        if (credentials.isEmpty())
            EmptyState(
                strings.getString(R.string.no_qualifications),
                strings.getString(R.string.qualifications_hint),
            )
    }
}

@Composable
fun HistoryScreen(model: AppModel, go: (String) -> Unit) {
    val strings = localizedResources()
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) {
        try {
            model.refreshPrivate()
        } catch (e: Exception) {
            model.report(e)
        }
    }
    Page {
        if (model.applications.isEmpty())
            EmptyState(
                strings.getString(R.string.no_applications),
                strings.getString(R.string.no_applications_hint),
            )
        model.applications.forEach { item ->
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    TextButton(onClick = { go("task/${item.taskId}") }) {
                        Text(item.taskTitle, style = MaterialTheme.typography.titleMedium)
                    }
                    InfoRow(
                        strings.getString(R.string.status),
                        item.statusLabel?.let(strings::getString) ?: item.status,
                    )
                    Text(item.organizerName, style = MaterialTheme.typography.bodySmall)
                    if (item.status == "expired")
                        Text(strings.getString(R.string.application_expired_reason))
                    else item.response?.let { Text(it) }
                    Text(
                        if (item.contactsReleased)
                            strings.getString(
                                R.string.authorized_contacts,
                                item.contactFields.joinToString(
                                    strings.getString(R.string.list_separator)
                                ) {
                                    fieldLabels[it]?.let(strings::getString) ?: it
                                },
                            )
                        else strings.getString(R.string.contacts_private),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.secondary,
                    )
                    Text(
                        strings.getString(R.string.applied_at, displayTime(item.createdAt)),
                        style = MaterialTheme.typography.labelSmall,
                    )
                    if (item.status == "pending")
                        TextButton(
                            onClick = {
                                scope.launch {
                                    try {
                                        model.api.raw(
                                            "/v1/applications/${item.id}/withdraw",
                                            "POST",
                                            "{}",
                                        )
                                        model.refreshPrivate()
                                    } catch (e: Exception) {
                                        model.report(e)
                                    }
                                }
                            }
                        ) {
                            Text(
                                strings.getString(R.string.withdraw_application),
                                color = MaterialTheme.colorScheme.error,
                            )
                        }
                }
            }
        }
    }
}

@Composable
fun SettingsScreen(model: AppModel, passkeys: () -> Unit) {
    val strings = localizedResources()
    val scope = rememberCoroutineScope()
    Page {
        SectionTitle(strings.getString(R.string.notification_preferences))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(strings.getString(R.string.nearby_setting), Modifier.weight(1f))
            Switch(model.nearbyEnabled, model::setNearby)
        }
        Text(
            strings.getString(R.string.nearby_setting_hint),
            style = MaterialTheme.typography.bodySmall,
        )
        if (model.profile != null) {
            SectionTitle(strings.getString(R.string.account_security))
            NavigationRow(
                strings.getString(R.string.passkeys),
                strings.getString(R.string.passkeys_summary),
                passkeys,
            )
        }
        InfoRow(strings.getString(R.string.version), strings.getString(R.string.version_value))
        Text(
            strings.getString(R.string.service_description),
            style = MaterialTheme.typography.bodySmall,
        )
        if (model.profile != null)
            OutlinedButton(
                onClick = {
                    scope.launch {
                        try {
                            model.logout()
                        } catch (e: Exception) {
                            model.report(e)
                        }
                    }
                }
            ) {
                Text(strings.getString(R.string.sign_out))
            }
    }
}
