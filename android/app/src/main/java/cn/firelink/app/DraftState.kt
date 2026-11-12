package cn.firelink.app

import androidx.compose.runtime.saveable.Saver
import kotlinx.serialization.json.Json
import kotlinx.serialization.serializer

/** Save small user-authored drafts, never the downloaded task/media payload. */
inline fun <reified T> jsonSaver() =
    Saver<T, String>(
        save = { Json.encodeToString(serializer<T>(), it) },
        restore = { Json.decodeFromString<T>(it) },
    )
