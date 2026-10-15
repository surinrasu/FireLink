package cn.firelink.app

import android.content.res.Resources
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext

/** Observe configuration changes, including language changes made in system settings. */
@Composable
fun localizedResources(): Resources {
    LocalConfiguration.current
    return LocalContext.current.resources
}

fun Resources.genderLabel(value: String): String =
    when (value) {
        "男" -> getString(R.string.gender_male)
        "女" -> getString(R.string.gender_female)
        else -> value
    }

/** Use the locale that selected the app resources, so API messages match the interface. */
fun Resources.apiLanguage(): String = getString(R.string.language_tag)
