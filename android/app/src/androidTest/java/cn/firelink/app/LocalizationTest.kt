package cn.firelink.app

import android.content.res.Configuration
import android.os.LocaleList
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.util.Locale
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** Exercise Android's actual resource resolver, including script and region fallback. */
@RunWith(AndroidJUnit4::class)
class LocalizationTest {
    private fun resources(vararg languages: String) =
        InstrumentationRegistry.getInstrumentation().targetContext.let { context ->
            val config = Configuration(context.resources.configuration)
            config.setLocales(LocaleList(*languages.map(Locale::forLanguageTag).toTypedArray()))
            context.createConfigurationContext(config).resources
        }

    @Test
    fun systemLanguageMatching() {
        for ((language, expected) in
            listOf(
                "en-US" to "en",
                "en-GB" to "en",
                "zh-CN" to "zh-Hans",
                "zh-SG" to "zh-Hans",
                "zh-Hans" to "zh-Hans",
                "zh-TW" to "zh-Hant",
                "zh-Hant" to "zh-Hant",
                "zh-HK" to "zh-Hant-HK",
                "zh-MO" to "zh-Hant-HK",
                "zh-Hans-HK" to "zh-Hans",
                "fr-FR" to "en",
            )) {
            assertEquals(language, expected, resources(language).apiLanguage())
        }
        assertEquals("zh-Hant", resources("fr-FR", "zh-TW", "en").apiLanguage())
    }

    @Test
    fun translationsAndFormattedNotifications() {
        for ((language, expected) in
            listOf("en" to "Passkeys", "zh-CN" to "通行密钥", "zh-TW" to "通行金鑰", "zh-HK" to "通行密鑰")) {
            val strings = resources(language)
            assertEquals(expected, strings.getString(R.string.passkeys))
            val notice = strings.getString(R.string.identity_notification, "Alex", "123456")
            assertTrue(notice.contains("Alex"))
            assertTrue(notice.contains("123456"))
            assertTrue(notice.contains("\n"))
            assertFalse(notice.contains("%s"))
            assertTrue(strings.getString(R.string.unread_notification_count, 12).contains("12"))
        }
    }
}
