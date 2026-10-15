package cn.firelink.app

import android.app.Application
import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.compose.runtime.*
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.*

class TokenStore(context: Context) {
    private val prefs = context.getSharedPreferences("secure-session", Context.MODE_PRIVATE)

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey("firelink-session", null) as? SecretKey)?.let {
            return it
        }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
            .apply {
                init(
                    KeyGenParameterSpec.Builder(
                            "firelink-session",
                            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                        )
                        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                        .build()
                )
            }
            .generateKey()
    }

    fun read(): String? =
        runCatching {
                val raw = prefs.getString("token", null) ?: return null
                val bytes = Base64.decode(raw, Base64.NO_WRAP)
                Cipher.getInstance("AES/GCM/NoPadding").run {
                    init(
                        Cipher.DECRYPT_MODE,
                        key(),
                        GCMParameterSpec(128, bytes.copyOfRange(0, 12)),
                    )
                    String(doFinal(bytes.copyOfRange(12, bytes.size)))
                }
            }
            .getOrNull()

    fun save(token: String?) {
        if (token == null) {
            prefs.edit().clear().apply()
            return
        }
        val cipher =
            Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        prefs
            .edit()
            .putString(
                "token",
                Base64.encodeToString(
                    cipher.iv + cipher.doFinal(token.toByteArray()),
                    Base64.NO_WRAP,
                ),
            )
            .apply()
    }
}

class ServiceException(message: String, val status: Int = 0) : Exception(message)

class Api(
    var baseURL: String,
    var token: String?,
    private val strings: android.content.res.Resources,
) {
    val json = Json { ignoreUnknownKeys = true }

    suspend fun raw(
        path: String,
        method: String = "GET",
        body: String? = null,
        bytes: ByteArray? = null,
        headers: Map<String, String> = emptyMap(),
    ): String =
        withContext(Dispatchers.IO) {
            if (BuildConfig.DEMO_MODE) {
                require(baseURL == DemoMode.SERVER && path.startsWith("/v1/")) {
                    "演示版本只能连接专用本地服务"
                }
            }
            val connection = URL(baseURL + path).openConnection() as HttpURLConnection
            try {
                if (BuildConfig.DEMO_MODE) connection.instanceFollowRedirects = false
                connection.requestMethod = method
                connection.setRequestProperty("Accept-Language", strings.apiLanguage())
                connection.connectTimeout = 15000
                connection.readTimeout = 20000
                token?.let { connection.setRequestProperty("Authorization", "Bearer $it") }
                headers.forEach { (key, value) -> connection.setRequestProperty(key, value) }
                if (body != null || bytes != null) {
                    connection.doOutput = true
                    if (body != null)
                        connection.setRequestProperty("Content-Type", "application/json")
                    connection.outputStream.use { it.write(bytes ?: body!!.toByteArray()) }
                }
                val status = connection.responseCode
                val result =
                    (if (status in 200..299) connection.inputStream else connection.errorStream)
                        ?.bufferedReader()
                        ?.use { it.readText() } ?: "{}"
                if (status !in 200..299)
                    throw ServiceException(
                        runCatching {
                                json
                                    .parseToJsonElement(result)
                                    .jsonObject["error"]
                                    ?.jsonPrimitive
                                    ?.content
                            }
                            .getOrNull() ?: strings.getString(R.string.request_retry),
                        status,
                    )
                result
            } finally {
                connection.disconnect()
            }
        }

    suspend inline fun <reified T> get(path: String): T = json.decodeFromString(raw(path))

    suspend inline fun <reified T> post(path: String, body: JsonObject = buildJsonObject {}): T =
        json.decodeFromString(raw(path, "POST", body.toString()))
}

class AppModel(application: Application) : AndroidViewModel(application) {
    private val strings
        get() = getApplication<Application>().resources

    private val prefs = application.getSharedPreferences("settings", Context.MODE_PRIVATE)
    private val tokenStore = TokenStore(application)
    val api =
        Api(
            if (BuildConfig.DEMO_MODE) DemoMode.SERVER
            else prefs.getString("serverURL", "http://10.0.2.2:8787")!!,
            if (BuildConfig.DEMO_MODE) DemoMode.TOKEN else tokenStore.read(),
            application.resources,
        )
    var profile by mutableStateOf<Profile?>(null)
        private set

    var incidents by mutableStateOf<List<Incident>>(emptyList())
        private set

    var articles by mutableStateOf<List<Article>>(emptyList())
        private set

    var applications by mutableStateOf<List<ApplicationRecord>>(emptyList())
        private set

    var notifications by mutableStateOf<List<Notice>>(emptyList())
        private set

    var config by mutableStateOf<ServerConfig?>(null)
        private set

    var error by mutableStateOf<String?>(null)
    var loading by mutableStateOf(false)
        private set

    var nearbyEnabled by mutableStateOf(prefs.getBoolean("nearby", true))
        private set

    fun report(e: Throwable) {
        if (e is ServiceException && e.status == 401) clearSession()
        error = e.message ?: strings.getString(R.string.operation_failed)
    }

    fun load() {
        viewModelScope.launch {
            loading = true
            try {
                config = api.get("/v1/config")
                incidents = api.get("/v1/incidents")
                articles = api.get("/v1/articles")
                if (api.token != null) refreshPrivate()
            } catch (e: Exception) {
                report(e)
            } finally {
                loading = false
            }
        }
    }

    suspend fun refreshPrivate() {
        profile = api.get("/v1/me")
        applications = api.get("/v1/applications")
        refreshNotifications()
    }

    suspend fun refreshNotifications() {
        notifications = api.get("/v1/notifications")
    }

    suspend fun markNotificationRead(id: String) {
        if (notifications.none { it.id == id && it.readAt == null }) return
        api.raw("/v1/notifications/$id/read", "POST", "{}")
        val readAt = if (BuildConfig.DEMO_MODE) DemoMode.NOW else java.time.Instant.now().toString()
        notifications = notifications.map { if (it.id == id) it.copy(readAt = readAt) else it }
    }

    suspend fun accept(result: AuthResult) {
        val token =
            result.token ?: throw ServiceException(strings.getString(R.string.invalid_login))
        tokenStore.save(token)
        api.token = token
        profile = result.profile
        refreshPrivate()
    }

    suspend fun saveProfile(p: Profile) {
        profile = api.json.decodeFromString(api.raw("/v1/me", "PATCH", api.json.encodeToString(p)))
    }

    suspend fun reverify(realName: String, idNumber: String): Profile {
        val p: Profile =
            api.post(
                "/v1/me/reverify",
                buildJsonObject {
                    put("realName", realName)
                    put("idNumber", idNumber)
                },
            )
        profile = p
        return p
    }

    suspend fun logout() {
        api.raw("/v1/me/logout", "POST", "{}")
        clearSession()
    }

    private fun clearSession() {
        tokenStore.save(null)
        api.token = null
        profile = null
        applications = emptyList()
        notifications = emptyList()
    }

    fun setServer(address: String) {
        val cleaned = address.trim().trimEnd('/')
        require(!BuildConfig.DEMO_MODE || cleaned == DemoMode.SERVER) { "演示版本只能连接专用本地服务" }
        val url = runCatching { URL(cleaned) }.getOrNull()
        require(url != null && url.protocol in listOf("http", "https") && url.host.isNotBlank()) {
            strings.getString(R.string.enter_server_url)
        }
        if (cleaned != api.baseURL) clearSession()
        api.baseURL = cleaned
        prefs.edit().putString("serverURL", cleaned).apply()
        load()
    }

    fun setNearby(value: Boolean) {
        nearbyEnabled = value
        prefs.edit().putBoolean("nearby", value).apply()
    }

    suspend fun upload(bytes: ByteArray, mime: String, filename: String, title: String) {
        if (bytes.size > 8 * 1024 * 1024)
            throw ServiceException(strings.getString(R.string.attachment_too_large))
        api.raw(
            "/v1/credentials",
            "POST",
            bytes = bytes,
            headers =
                mapOf(
                    "Content-Type" to mime,
                    "X-File-Name" to URLEncoder.encode(filename, "UTF-8").replace("+", "%20"),
                    "X-Certificate-Title" to URLEncoder.encode(title, "UTF-8").replace("+", "%20"),
                ),
        )
    }
}
