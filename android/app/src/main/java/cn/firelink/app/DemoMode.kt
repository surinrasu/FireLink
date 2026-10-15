package cn.firelink.app

import android.content.Context
import android.content.res.Configuration
import android.os.LocaleList
import java.time.LocalDate
import java.util.Locale
import java.util.TimeZone

/** Only the separate .demo APK enables these hooks. No configurable remote endpoint. */
object DemoMode {
    const val SERVER = "http://127.0.0.1:4173"
    const val TOKEN = "firelink-local-presentation"
    const val NOW = "2026-10-15T09:00:00Z"
    val today: LocalDate get() = LocalDate.parse("2026-10-15")

    fun context(base: Context): Context {
        if (!BuildConfig.DEMO_MODE) return base
        val locale = Locale.forLanguageTag("zh-Hans-CN")
        Locale.setDefault(locale)
        TimeZone.setDefault(TimeZone.getTimeZone("Asia/Shanghai"))
        return base.createConfigurationContext(Configuration(base.resources.configuration).apply {
            setLocales(LocaleList(locale))
            fontScale = 1f
        })
    }
}
