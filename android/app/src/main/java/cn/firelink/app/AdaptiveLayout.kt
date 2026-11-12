package cn.firelink.app

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

val ReadingWidth = 760.dp
val OverviewWidth = 1200.dp

/** A reading measure shared by forms, articles and task details, inside any pane. */
@Composable
fun ReadingColumn(
    modifier: Modifier = Modifier,
    maxWidth: Dp = ReadingWidth,
    content: @Composable () -> Unit,
) {
    Box(modifier.fillMaxWidth(), contentAlignment = Alignment.TopCenter) {
        Box(Modifier.widthIn(max = maxWidth).fillMaxWidth()) { content() }
    }
}

@Composable
fun HomeSections(opportunities: @Composable () -> Unit, guides: @Composable () -> Unit) {
    val fontScale = LocalDensity.current.fontScale.coerceAtLeast(1f)
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        if (maxWidth >= (760 * fontScale).dp) {
            Row(horizontalArrangement = Arrangement.spacedBy(32.dp)) {
                Column(Modifier.weight(1.2f), verticalArrangement = Arrangement.spacedBy(20.dp)) {
                    opportunities()
                }
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(20.dp)) {
                    guides()
                }
            }
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(20.dp)) {
                opportunities()
                guides()
            }
        }
    }
}
