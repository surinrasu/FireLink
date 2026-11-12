package cn.firelink.app

import android.net.Uri
import android.widget.MediaController
import android.widget.VideoView
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive

@Composable
fun InlineVideo(url: String?) {
    if (url.isNullOrBlank()) return
    var position by rememberSaveable(url) { mutableIntStateOf(0) }
    var playing by rememberSaveable(url) { mutableStateOf(false) }
    var prepared by remember(url) { mutableStateOf(false) }
    var player by remember(url) { mutableStateOf<VideoView?>(null) }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    fun capturePlayback() {
        if (prepared)
            player?.let {
                position = it.currentPosition
                playing = it.isPlaying
            }
    }
    LaunchedEffect(player) {
        while (isActive) {
            if (lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) capturePlayback()
            delay(200)
        }
    }
    DisposableEffect(lifecycle, player) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_STOP -> {
                    capturePlayback()
                    player?.pause()
                }
                Lifecycle.Event.ON_START -> if (prepared && playing) player?.start()
                else -> Unit
            }
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        key(url) {
            AndroidView(
                factory = { context ->
                    VideoView(context).apply {
                        player = this
                        setMediaController(MediaController(context).also { it.setAnchorView(this) })
                        setOnPreparedListener {
                            prepared = true
                            seekTo(position)
                            if (
                                playing && lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)
                            )
                                start()
                        }
                        setVideoURI(Uri.parse(url))
                    }
                },
                onRelease = {
                    if (lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) capturePlayback()
                    it.stopPlayback()
                    prepared = false
                    player = null
                },
                modifier = Modifier.fillMaxWidth().height((maxWidth * 9 / 16).coerceAtMost(420.dp)),
            )
        }
    }
}
