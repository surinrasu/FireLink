package cn.firelink.app

import android.content.Context
import android.content.res.Configuration
import android.os.LocaleList
import android.view.View
import android.view.ViewTreeObserver
import androidx.compose.runtime.withFrameNanos
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.time.LocalDate
import java.util.Locale
import java.util.TimeZone
import kotlin.coroutines.resume
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Only the separate .demo APK enables these hooks. No configurable remote endpoint. */
object DemoMode {
    const val SERVER = "http://127.0.0.1:4173"
    const val TOKEN = "firelink-local-presentation"
    const val NOW = "2026-10-15T09:00:00Z"
    val today: LocalDate
        get() = LocalDate.parse("2026-10-15")

    suspend fun reportReady(view: View, token: String, route: String, dark: Boolean) {
        if (!BuildConfig.DEMO_MODE || !view.isHardwareAccelerated) return
        // A first buffer can be committed while Android still shows the launcher
        // or starting window, especially after changing the system theme.
        if (!view.hasWindowFocus()) {
            suspendCancellableCoroutine<Unit> { continuation ->
                val observer = view.viewTreeObserver
                val focused =
                    object : ViewTreeObserver.OnWindowFocusChangeListener {
                        override fun onWindowFocusChanged(hasFocus: Boolean) {
                            if (hasFocus && continuation.isActive) {
                                if (observer.isAlive)
                                    observer.removeOnWindowFocusChangeListener(this)
                                continuation.resume(Unit)
                            }
                        }
                    }
                observer.addOnWindowFocusChangeListener(focused)
                continuation.invokeOnCancellation {
                    view.post {
                        if (observer.isAlive) observer.removeOnWindowFocusChangeListener(focused)
                    }
                }
            }
        }
        // Wait for the composed destination to reach the render buffer, rather
        // than treating Activity creation or a completed HTTP request as ready.
        suspendCancellableCoroutine<Unit> { continuation ->
            val observer = view.viewTreeObserver
            val committed = Runnable { if (continuation.isActive) continuation.resume(Unit) }
            observer.registerFrameCommitCallback(committed)
            continuation.invokeOnCancellation {
                view.post {
                    if (observer.isAlive) observer.unregisterFrameCommitCallback(committed)
                }
            }
            view.invalidate()
        }
        // The committed buffer is submitted before the display compositor has
        // presented it. Allow presentation and system-bar appearance to catch up.
        repeat(2) { withFrameNanos {} }
        withContext(Dispatchers.IO) {
            val connection = URL("$SERVER/api/demo/ready").openConnection() as HttpURLConnection
            try {
                connection.instanceFollowRedirects = false
                connection.connectTimeout = 1000
                connection.readTimeout = 1000
                connection.requestMethod = "POST"
                connection.setRequestProperty("Authorization", "Bearer $TOKEN")
                connection.setRequestProperty("Content-Type", "application/json")
                connection.doOutput = true
                val body = buildJsonObject {
                    put("token", token)
                    put("route", route)
                    put("theme", if (dark) "dark" else "light")
                }
                connection.outputStream.use { it.write(body.toString().toByteArray()) }
                connection.responseCode
            } catch (_: IOException) {
                // The controller falls back to checking the actual UI hierarchy.
            } finally {
                connection.disconnect()
            }
        }
    }

    fun context(base: Context): Context {
        if (!BuildConfig.DEMO_MODE) return base
        val locale = Locale.forLanguageTag("zh-Hans-CN")
        Locale.setDefault(locale)
        TimeZone.setDefault(TimeZone.getTimeZone("Asia/Shanghai"))
        return base.createConfigurationContext(
            Configuration(base.resources.configuration).apply {
                setLocales(LocaleList(locale))
                fontScale = 1f
            }
        )
    }
}
