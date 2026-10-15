package cn.firelink.app

import android.content.Context
import android.content.MutableContextWrapper
import android.os.Build
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.credentials.*
import androidx.credentials.exceptions.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*

@Serializable private data class PasskeyChallenge(val challengeId: String, val options: JsonObject)

@Serializable data class PasskeyEntry(val id: String, val createdAt: String)

class NativePasskeys(private val context: Context) {
    private val strings
        get() = context.resources

    private val manager = CredentialManager.create(context)

    private fun request(options: JsonObject) =
        GetCredentialRequest(
            listOf(GetPublicKeyCredentialOption(options.toString())),
            preferImmediatelyAvailableCredentials = true,
        )

    // Query the provider, never infer availability from a local "created a passkey" flag.
    suspend fun available(api: Api): Boolean {
        if (Build.VERSION.SDK_INT < 34) return false
        val challenge: PasskeyChallenge = api.post("/v1/auth/passkeys/options")
        val result = manager.prepareGetCredential(request(challenge.options))
        return result.hasCredentialResults(PublicKeyCredential.TYPE_PUBLIC_KEY_CREDENTIAL) ||
            result.hasAuthenticationResults()
    }

    suspend fun login(model: AppModel) {
        // Fetch a fresh challenge when the user chooses the entry; preflight may be minutes old.
        val challenge: PasskeyChallenge = model.api.post("/v1/auth/passkeys/options")
        val result =
            manager
                .getCredential(MutableContextWrapper(context), request(challenge.options))
                .credential
        val credential =
            result as? PublicKeyCredential
                ?: throw ServiceException(strings.getString(R.string.passkey_read_failed))
        val auth: AuthResult =
            model.api.post(
                "/v1/auth/passkeys/verify",
                payload(challenge.challengeId, credential.authenticationResponseJson),
            )
        model.accept(auth)
    }

    suspend fun create(model: AppModel) {
        if (model.config?.passkeys != true)
            throw ServiceException(strings.getString(R.string.passkey_unavailable))
        val challenge: PasskeyChallenge = model.api.post("/v1/me/passkeys/options")
        val result =
            manager.createCredential(
                MutableContextWrapper(context),
                CreatePublicKeyCredentialRequest(challenge.options.toString()),
            )
        val credential =
            result as? CreatePublicKeyCredentialResponse
                ?: throw ServiceException(strings.getString(R.string.passkey_create_failed))
        model.api.raw(
            "/v1/me/passkeys/verify",
            "POST",
            payload(challenge.challengeId, credential.registrationResponseJson).toString(),
        )
    }

    private fun payload(challengeId: String, raw: String): JsonObject {
        val response = Json.parseToJsonElement(raw).jsonObject.toMutableMap()
        response.putIfAbsent("clientExtensionResults", buildJsonObject {})
        response["response"]?.jsonObject?.let { data ->
            response["response"] =
                JsonObject(data.filterNot { it.key == "userHandle" && it.value == JsonNull })
        }
        return buildJsonObject {
            put("challengeId", challengeId)
            put("response", JsonObject(response))
        }
    }
}

@Composable
fun PasskeyLoginOption(
    model: AppModel,
    enabled: Boolean,
    done: () -> Unit,
    onError: (String) -> Unit,
) {
    val strings = localizedResources()
    val context = LocalContext.current
    val service = remember(context) { NativePasskeys(context) }
    val scope = rememberCoroutineScope()
    var available by remember { mutableStateOf(false) }
    var signingIn by remember { mutableStateOf(false) }
    val currentDone by rememberUpdatedState(done)
    val currentError by rememberUpdatedState(onError)
    suspend fun signIn(automatic: Boolean = false) {
        signingIn = true
        try {
            service.login(model)
            currentDone()
        } catch (e: CancellationException) {
            throw e
        } catch (_: NoCredentialException) {
            available = false
        } catch (_: GetCredentialCancellationException) {
            if (automatic) available = true
        } catch (e: Exception) {
            if (!automatic) currentError(strings.getString(R.string.passkey_sign_in_failed))
        } finally {
            signingIn = false
        }
    }
    LaunchedEffect(model.config?.passkeys) {
        available = false
        if (model.config?.passkeys == true) {
            if (Build.VERSION.SDK_INT >= 34) {
                try {
                    available = service.available(model.api)
                } catch (e: CancellationException) {
                    throw e
                } catch (_: Exception) {
                    /* An unavailable provider does not interrupt SMS sign-in. */
                }
            } else {
                // Older Android has no preflight API. The system sheet appears only for local
                // credentials.
                signIn(automatic = true)
            }
        }
    }
    if (available)
        OutlinedButton(
            onClick = { scope.launch { signIn() } },
            enabled = enabled && !signingIn,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Icon(Icons.Outlined.Key, null)
            Spacer(Modifier.width(8.dp))
            Text(
                if (signingIn) strings.getString(R.string.verifying)
                else strings.getString(R.string.sign_in_passkey)
            )
        }
}

@Composable
fun PasskeySettingsScreen(model: AppModel) {
    val strings = localizedResources()
    val context = LocalContext.current
    val service = remember(context) { NativePasskeys(context) }
    val scope = rememberCoroutineScope()
    var entries by remember { mutableStateOf<List<PasskeyEntry>>(emptyList()) }
    var busy by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf<PasskeyEntry?>(null) }
    var loaded by remember { mutableStateOf(false) }
    suspend fun reload() {
        entries = model.api.get("/v1/me/passkeys")
        loaded = true
    }
    LaunchedEffect(Unit) {
        try {
            reload()
        } catch (e: Exception) {
            model.report(e)
        }
    }
    Page {
        Text(strings.getString(R.string.passkey_hint))
        Button(
            enabled = !busy,
            onClick = {
                scope.launch {
                    busy = true
                    try {
                        service.create(model)
                        reload()
                    } catch (e: CancellationException) {
                        throw e
                    } catch (_: CreateCredentialCancellationException) {} catch (
                        e: ServiceException) {
                        model.report(e)
                    } catch (_: Exception) {
                        model.error = strings.getString(R.string.passkey_add_failed)
                    } finally {
                        busy = false
                    }
                }
            },
        ) {
            Text(
                if (busy) strings.getString(R.string.adding)
                else strings.getString(R.string.add_passkey)
            )
        }
        if (loaded && entries.isEmpty()) Text(strings.getString(R.string.no_passkeys))
        entries.forEachIndexed { index, entry ->
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        strings.getString(R.string.passkey_number, index + 1),
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Text(
                        strings.getString(R.string.added_at, displayTime(entry.createdAt)),
                        style = MaterialTheme.typography.bodySmall,
                    )
                    TextButton(enabled = !busy, onClick = { deleting = entry }) {
                        Text(
                            strings.getString(R.string.delete),
                            color = MaterialTheme.colorScheme.error,
                        )
                    }
                }
            }
        }
    }
    deleting?.let { entry ->
        AlertDialog(
            onDismissRequest = { deleting = null },
            title = { Text(strings.getString(R.string.delete_passkey_title)) },
            text = { Text(strings.getString(R.string.delete_passkey_hint)) },
            confirmButton = {
                TextButton(
                    onClick = {
                        deleting = null
                        scope.launch {
                            busy = true
                            try {
                                model.api.raw("/v1/me/passkeys/${entry.id}", "DELETE")
                                reload()
                            } catch (e: Exception) {
                                model.report(e)
                            } finally {
                                busy = false
                            }
                        }
                    }
                ) {
                    Text(strings.getString(R.string.delete))
                }
            },
            dismissButton = {
                TextButton(onClick = { deleting = null }) {
                    Text(strings.getString(R.string.cancel))
                }
            },
        )
    }
}
