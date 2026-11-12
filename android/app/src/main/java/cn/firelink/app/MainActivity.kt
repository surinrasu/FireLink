package cn.firelink.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import coil.compose.AsyncImage
import kotlin.math.ln
import kotlin.math.tan
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*

class MainActivity : ComponentActivity() {
    override fun attachBaseContext(newBase: android.content.Context) {
        super.attachBaseContext(DemoMode.context(newBase))
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            val dark = isSystemInDarkTheme()
            MaterialTheme(
                colorScheme =
                    if (dark)
                        darkColorScheme(
                            primary = Color(0xFFFFB4A1),
                            secondary = Color(0xFFB8CCAC),
                            background = Color(0xFF1B1C19),
                            surface = Color(0xFF1B1C19),
                            surfaceContainer = Color(0xFF2B2D27),
                            surfaceContainerLow = Color(0xFF23251F),
                            secondaryContainer = Color(0xFF50372D),
                            onSecondaryContainer = Color(0xFFFFDBCE),
                        )
                    else
                        lightColorScheme(
                            primary = Color(0xFFB73D25),
                            secondary = Color(0xFF47664B),
                            background = Color(0xFFFFFBF7),
                            surface = Color(0xFFFFFBF7),
                            surfaceContainer = Color(0xFFF8EEE6),
                            surfaceContainerLow = Color(0xFFFFF5EE),
                            secondaryContainer = Color(0xFFF6DDD1),
                            onSecondaryContainer = Color(0xFF5D2517),
                        )
            ) {
                FireLink(
                    initialRoute =
                        if (BuildConfig.DEMO_MODE) intent.getStringExtra("demoRoute") ?: "home"
                        else "home",
                    demoReadyToken =
                        if (BuildConfig.DEMO_MODE) intent.getStringExtra("demoReadyToken") else null,
                )
            }
        }
    }
}

@Composable
fun Page(maxWidth: Dp = ReadingWidth, content: @Composable ColumnScope.() -> Unit) {
    Box(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()),
        contentAlignment = Alignment.TopCenter,
    ) {
        Column(
            Modifier.widthIn(max = maxWidth).fillMaxWidth().padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
            content = content,
        )
    }
}

@Composable
fun SectionTitle(text: String) {
    Text(text, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
}

@Composable
fun EmptyState(title: String, description: String) {
    Column(
        Modifier.fillMaxWidth().padding(vertical = 36.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(
            Icons.Outlined.Inbox,
            null,
            Modifier.size(40.dp),
            tint = MaterialTheme.colorScheme.primary,
        )
        Text(title, style = MaterialTheme.typography.titleMedium)
        Text(description, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
fun IncidentsScreen(model: AppModel, go: (String) -> Unit, selectedIncidentId: String? = null) {
    val strings = localizedResources()
    var selected by rememberSaveable { mutableStateOf(IncidentSort.UPDATED) }
    var expanded by remember { mutableStateOf(false) }
    Page {
        Box {
            OutlinedButton(onClick = { expanded = true }) {
                Icon(Icons.Outlined.Sort, strings.getString(R.string.sort_by))
                Spacer(Modifier.width(8.dp))
                Text(strings.getString(selected.label))
                Icon(Icons.Outlined.ArrowDropDown, null)
            }
            DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                IncidentSort.entries.forEach { option ->
                    DropdownMenuItem(
                        text = { Text(strings.getString(option.label)) },
                        leadingIcon = { RadioButton(selected == option, null) },
                        onClick = {
                            selected = option
                            expanded = false
                        },
                    )
                }
            }
        }
        selected.apply(model.incidents).forEach {
            IncidentCard(it, selected = it.id == selectedIncidentId) { go("incident/${it.id}") }
        }
        if (model.incidents.isEmpty())
            EmptyState(
                strings.getString(R.string.no_incidents),
                strings.getString(R.string.no_incidents_hint),
            )
    }
}

@Composable
fun HomeScreen(model: AppModel, go: (String) -> Unit) {
    val strings = localizedResources()
    val scope = rememberCoroutineScope()
    var openingNotice by remember { mutableStateOf(false) }
    val unread = model.notifications.filter { it.readAt == null }.take(2)
    Page(maxWidth = OverviewWidth) {
        if (unread.isNotEmpty()) {
            Surface(
                color = MaterialTheme.colorScheme.surfaceContainerLow,
                shape = RoundedCornerShape(16.dp),
            ) {
                Column {
                    unread.forEachIndexed { index, notice ->
                        if (index > 0) HorizontalDivider(Modifier.padding(horizontal = 16.dp))
                        Row(
                            Modifier.fillMaxWidth()
                                .clickable(enabled = !openingNotice) {
                                    openingNotice = true
                                    scope.launch {
                                        try {
                                            model.markNotificationRead(notice.id)
                                            go(
                                                if (notice.applicationId != null) "history"
                                                else "notifications"
                                            )
                                        } catch (e: Exception) {
                                            model.report(e)
                                        } finally {
                                            openingNotice = false
                                        }
                                    }
                                }
                                .heightIn(min = 48.dp)
                                .padding(horizontal = 16.dp, vertical = 12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Icon(
                                Icons.Outlined.Notifications,
                                strings.getString(R.string.unread_notifications),
                                Modifier.size(20.dp),
                                tint = MaterialTheme.colorScheme.primary,
                            )
                            Column(
                                Modifier.weight(1f),
                                verticalArrangement = Arrangement.spacedBy(4.dp),
                            ) {
                                Text(
                                    notice.title,
                                    style = MaterialTheme.typography.labelLarge,
                                    fontWeight = FontWeight.Bold,
                                )
                                Text(
                                    notice.body,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    maxLines = 2,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                            Icon(Icons.Outlined.ChevronRight, null, Modifier.size(18.dp))
                        }
                    }
                }
            }
        }
        val region = model.profile?.region.orEmpty()
        val nearby =
            if (model.nearbyEnabled && region.isNotBlank())
                model.incidents.firstOrNull {
                    it.region == region ||
                        it.region.split(' ').any { part ->
                            part.length >= 2 && region.contains(part)
                        }
                }
            else null
        HomeSections(
            opportunities = {
                (nearby ?: model.incidents.firstOrNull())?.let {
                    SectionTitle(
                        if (nearby != null) strings.getString(R.string.nearby_opportunities)
                        else strings.getString(R.string.recruiting)
                    )
                    IncidentCard(it) { go("incident/${it.id}") }
                }
            },
            guides = {
                SectionTitle(strings.getString(R.string.guides))
                model.articles.forEach { article ->
                    Card(
                        onClick = { go("article/${article.id}") },
                        modifier = Modifier.fillMaxWidth(),
                        colors =
                            CardDefaults.cardColors(
                                containerColor = MaterialTheme.colorScheme.surfaceContainerLow
                            ),
                    ) {
                        Row(
                            Modifier.padding(18.dp),
                            horizontalArrangement = Arrangement.spacedBy(16.dp),
                        ) {
                            Icon(
                                Icons.Outlined.MenuBook,
                                null,
                                tint = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.size(36.dp),
                            )
                            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                Text(
                                    strings.getString(
                                        R.string.article_read_time,
                                        article.category,
                                        article.minutes,
                                    ),
                                    style = MaterialTheme.typography.labelMedium,
                                )
                                Text(article.title, style = MaterialTheme.typography.titleMedium)
                                Text(article.summary, style = MaterialTheme.typography.bodyMedium)
                            }
                        }
                    }
                }
            },
        )
        if (model.loading) CircularProgressIndicator()
        if (model.incidents.isEmpty() && !model.loading)
            EmptyState(
                strings.getString(R.string.no_content),
                strings.getString(R.string.refresh_retry),
            )
    }
}

@Composable
fun MapPreview(latitude: Double, longitude: Double, annotations: List<MapAnnotation>? = null) {
    val strings = localizedResources()
    val primary = MaterialTheme.colorScheme.primary
    val dark = isSystemInDarkTheme()
    val land = if (dark) Color(0xFF28332B) else Color(0xFFE8EDE2)
    val park = if (dark) Color(0xFF40503F) else Color(0xFFD2E0CB)
    val road = if (dark) Color(0xFF657260) else Color.White
    val label = if (dark) Color(0xFFD3DFCC) else Color(0xFF475447)
    val labelBackground = if (dark) Color(0xFF243029) else Color.White
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        Box(
            Modifier.fillMaxWidth().height((maxWidth / 1.9f).coerceAtMost(300.dp)).background(land)
        ) {
            Canvas(Modifier.fillMaxSize()) {
                if (annotations == null) {
                    drawLine(
                        park,
                        Offset(0f, size.height * .25f),
                        Offset(size.width, size.height * .8f),
                        42.dp.toPx(),
                    )
                    for (i in 0..5) {
                        val x = size.width * i / 5
                        drawLine(
                            road,
                            Offset(x, 0f),
                            Offset(x + size.width * .15f, size.height),
                            9.dp.toPx(),
                        )
                    }
                    for (i in 1..3) {
                        val y = size.height * i / 4
                        drawLine(
                            road,
                            Offset(0f, y),
                            Offset(size.width, y - size.height * .1f),
                            7.dp.toPx(),
                        )
                    }
                } else {
                    for (i in 1..4) {
                        val x = size.width * i / 5
                        val y = size.height * i / 5
                        drawLine(
                            label.copy(alpha = .12f),
                            Offset(x, 0f),
                            Offset(x, size.height),
                            1.dp.toPx(),
                        )
                        drawLine(
                            label.copy(alpha = .12f),
                            Offset(0f, y),
                            Offset(size.width, y),
                            1.dp.toPx(),
                        )
                    }
                }
                val points = annotations.orEmpty().flatMap { it.coordinates }
                if (points.isEmpty()) {
                    drawCircle(primary.copy(alpha = .15f), 42.dp.toPx(), center)
                    drawCircle(primary, 9.dp.toPx(), center)
                    drawCircle(Color.White, 4.dp.toPx(), center)
                } else {
                    fun mercator(point: MapCoordinate): Pair<Double, Double> =
                        Math.toRadians(point.longitude) to
                            ln(
                                tan(
                                    Math.PI / 4 +
                                        Math.toRadians(point.latitude.coerceIn(-85.0, 85.0)) / 2
                                )
                            )
                    val projected = points.map(::mercator)
                    val minX = projected.minOf { it.first }
                    val maxX = projected.maxOf { it.first }
                    val minY = projected.minOf { it.second }
                    val maxY = projected.maxOf { it.second }
                    val scale =
                        minOf(
                            (size.width - 48.dp.toPx()) / (maxX - minX).coerceAtLeast(0.00001),
                            (size.height - 60.dp.toPx()) / (maxY - minY).coerceAtLeast(0.00001),
                        )
                    fun position(point: MapCoordinate): Offset {
                        val (x, y) = mercator(point)
                        return Offset(
                            center.x + ((x - (minX + maxX) / 2) * scale).toFloat(),
                            center.y - ((y - (minY + maxY) / 2) * scale).toFloat(),
                        )
                    }
                    annotations.orEmpty().forEach { annotation ->
                        val vertices = annotation.coordinates.map(::position)
                        if (vertices.size > 1 && annotation.type != "point") {
                            val path =
                                Path().apply {
                                    moveTo(vertices.first().x, vertices.first().y)
                                    vertices.drop(1).forEach { lineTo(it.x, it.y) }
                                    if (annotation.type == "area" && vertices.size >= 3) close()
                                }
                            if (annotation.type == "area" && vertices.size >= 3)
                                drawPath(path, primary.copy(alpha = .18f))
                            drawPath(path, primary, style = Stroke(3.dp.toPx()))
                        }
                        vertices.forEach { point ->
                            drawCircle(Color.White, 6.dp.toPx(), point)
                            drawCircle(primary, 4.dp.toPx(), point)
                        }
                    }
                }
            }
            Text(
                strings.getString(
                    if (annotations == null) R.string.location else R.string.map_annotations
                ),
                Modifier.align(Alignment.TopStart).padding(10.dp),
                style = MaterialTheme.typography.labelSmall,
                color = label,
            )
            Text(
                "%.4f°N  %.4f°E".format(latitude, longitude),
                Modifier.align(Alignment.BottomEnd)
                    .padding(10.dp)
                    .background(labelBackground.copy(alpha = .85f)),
                style = MaterialTheme.typography.labelSmall,
                color = label,
            )
        }
    }
}

@Composable
fun IncidentCard(incident: Incident, selected: Boolean = false, onClick: () -> Unit) {
    val strings = localizedResources()
    Card(
        onClick = onClick,
        shape = RoundedCornerShape(20.dp),
        modifier = Modifier.fillMaxWidth().semantics { this.selected = selected },
        colors =
            CardDefaults.cardColors(
                containerColor =
                    if (selected) MaterialTheme.colorScheme.secondaryContainer
                    else MaterialTheme.colorScheme.surfaceContainerLow
            ),
    ) {
        MapPreview(incident.latitude, incident.longitude)
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row {
                Text(
                    strings.getString(R.string.volunteer_opportunities),
                    color = MaterialTheme.colorScheme.primary,
                    style = MaterialTheme.typography.labelMedium,
                )
                Spacer(Modifier.weight(1f))
            }
            Text(
                incident.title,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
            )
            Text(incident.region, style = MaterialTheme.typography.bodySmall)
            incident.tasks.take(3).forEach {
                Row(Modifier.fillMaxWidth()) {
                    Text(it.title, Modifier.weight(1f))
                    Icon(Icons.Outlined.ChevronRight, null, Modifier.size(18.dp))
                }
            }
            Text(
                strings.getString(R.string.updated_at, displayTime(incident.updatedAt)),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

fun displayTime(value: String): String =
    runCatching {
            java.time.Instant.parse(value)
                .atZone(java.time.ZoneId.systemDefault())
                .format(
                    java.time.format.DateTimeFormatter.ofLocalizedDateTime(
                            java.time.format.FormatStyle.MEDIUM,
                            java.time.format.FormatStyle.SHORT,
                        )
                        .withLocale(java.util.Locale.getDefault())
                )
        }
        .getOrDefault(value.take(16))

@Composable
fun TaskScreen(
    id: String,
    model: AppModel,
    requireLogin: (String) -> Unit,
    go: (String) -> Unit,
    onLoaded: () -> Unit = {},
) {
    val strings = localizedResources()
    val state: TaskState = viewModel(key = "task/$id")
    val task = state.task
    val failure = state.failure
    var showContacts by rememberSaveable(id) { mutableStateOf(false) }
    LaunchedEffect(task) { if (task != null) onLoaded() }
    LaunchedEffect(id, model.api.baseURL, strings.apiLanguage()) {
        state.load(model.api, id, strings.apiLanguage())
    }
    if (showContacts) task?.let { OrganizerContactsSheet(it.organizer) { showContacts = false } }
    Column(Modifier.fillMaxSize()) {
        Box(Modifier.weight(1f)) {
            Page {
                task?.let { t ->
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Icon(
                            Icons.Outlined.Verified,
                            null,
                            tint = MaterialTheme.colorScheme.secondary,
                        )
                        Column {
                            Text(t.organizer.name, fontWeight = FontWeight.Bold)
                            Text(
                                if (t.organizer.verified)
                                    strings.getString(R.string.verified_organizer)
                                else strings.getString(R.string.unverified),
                                style = MaterialTheme.typography.labelMedium,
                            )
                        }
                    }
                    HorizontalDivider()
                    Text(
                        t.title,
                        style = MaterialTheme.typography.headlineLarge,
                        fontWeight = FontWeight.Bold,
                    )
                    Text(t.summary, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    ContentBlocks(t.blocks)
                }
                    ?: run {
                        if (failure != null) {
                            Text(failure!!)
                            Button(
                                onClick = {
                                    state.load(model.api, id, strings.apiLanguage(), retry = true)
                                }
                            ) {
                                Text(strings.getString(R.string.retry))
                            }
                        } else CircularProgressIndicator()
                    }
            }
        }
        task?.let { t ->
            Surface(shadowElevation = 4.dp) {
                ReadingColumn {
                    FlowRow(
                        Modifier.fillMaxWidth().padding(16.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp, Alignment.End),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        if (t.organizer.contacts.isNotEmpty()) {
                            TextButton(onClick = { showContacts = true }) {
                                Text(strings.getString(R.string.contact_organizer))
                            }
                        }
                        Button(
                            onClick = {
                                if (model.applications.any { it.taskId == id }) go("history")
                                else requireLogin("apply/$id")
                            },
                            enabled = t.status == "open",
                            modifier = Modifier.widthIn(min = 144.dp),
                        ) {
                            Text(
                                if (model.applications.any { it.taskId == id })
                                    strings.getString(R.string.view_applications)
                                else strings.getString(R.string.apply)
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun ContentBlocks(blocks: List<ContentBlock>) {
    blocks.forEach { block ->
        when (block.type) {
            "heading" ->
                Text(
                    block.text.orEmpty(),
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold,
                )
            "image" ->
                AsyncImage(
                    model = block.url,
                    contentDescription = block.text,
                    modifier = Modifier.fillMaxWidth(),
                )
            "video" -> InlineVideo(block.url)
            "map" -> {
                if (
                    block.annotations?.isNotEmpty() == true ||
                        (block.annotations == null &&
                            block.latitude != null &&
                            block.longitude != null)
                ) {
                    MapPreview(block.latitude ?: 0.0, block.longitude ?: 0.0, block.annotations)
                    Text(block.text.orEmpty(), style = MaterialTheme.typography.labelMedium)
                }
            }
            "table" ->
                Column(
                    Modifier.horizontalScroll(rememberScrollState())
                        .background(MaterialTheme.colorScheme.surfaceContainerLow)
                        .padding(12.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    block.rows.orEmpty().forEachIndexed { i, row ->
                        Row(horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                            row.forEach {
                                Text(
                                    it,
                                    modifier = Modifier.widthIn(min = 100.dp, max = 220.dp),
                                    fontWeight = if (i == 0) FontWeight.Bold else FontWeight.Normal,
                                )
                            }
                        }
                    }
                }
            else -> Text(block.text.orEmpty(), style = MaterialTheme.typography.bodyLarge)
        }
    }
}

@Composable
fun ApplyScreen(id: String, model: AppModel, onLoaded: () -> Unit = {}, done: () -> Unit) {
    val strings = localizedResources()
    val scope = rememberCoroutineScope()
    var initialized by rememberSaveable(id) { mutableStateOf(false) }
    val state: TaskState = viewModel(key = "apply/$id")
    val task = state.task
    var fields by
        rememberSaveable(id, stateSaver = jsonSaver<Set<String>>()) {
            mutableStateOf(setOf<String>())
        }
    var contacts by
        rememberSaveable(id, stateSaver = jsonSaver<Set<String>>()) {
            mutableStateOf(setOf<String>())
        }
    var customAnswers by
        rememberSaveable(id, stateSaver = jsonSaver<Map<String, String>>()) {
            mutableStateOf(mapOf<String, String>())
        }
    var consent by rememberSaveable(id) { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    LaunchedEffect(task) { if (task != null) onLoaded() }
    LaunchedEffect(id, model.api.baseURL, strings.apiLanguage()) {
        state.load(model.api, id, strings.apiLanguage())
    }
    LaunchedEffect(task) {
        task?.let { t ->
            if (!initialized) {
                fields = t.requiredFields.toSet()
                contacts = t.contactFields.toSet()
                initialized = true
            } else {
                fields = fields + t.requiredFields
                contacts = contacts + t.contactFields
            }
        }
    }
    Page {
        task?.let { t ->
            Text(t.title, style = MaterialTheme.typography.titleLarge)
            Text(strings.getString(R.string.shared_with, t.organizer.name))
            SectionTitle(strings.getString(R.string.profile_shared_now))
            fieldLabels
                .filterKeys { it !in listOf("phone", "wechat", "email") }
                .forEach { (key, label) ->
                    CheckRow(
                        strings.getString(label) +
                            if (key in t.requiredFields) strings.getString(R.string.required_suffix)
                            else "",
                        key in fields,
                        key !in t.requiredFields,
                    ) {
                        fields = if (it) fields + key else fields - key
                    }
                }
            SectionTitle(strings.getString(R.string.contacts_shared_on_acceptance))
            listOf("phone", "wechat", "email").forEach { key ->
                CheckRow(
                    (fieldLabels[key]?.let(strings::getString) ?: key) +
                        if (key in t.contactFields) strings.getString(R.string.required_suffix)
                        else "",
                    key in contacts,
                    key !in t.contactFields,
                ) {
                    contacts = if (it) contacts + key else contacts - key
                }
            }
            Text(
                strings.getString(R.string.contact_consent_hint),
                style = MaterialTheme.typography.bodySmall,
            )
            HorizontalDivider()
            if (t.customFields.isNotEmpty()) {
                SectionTitle(strings.getString(R.string.custom_fields))
                t.customFields.forEach { field ->
                    OutlinedTextField(
                        value = customAnswers[field].orEmpty(),
                        onValueChange = { customAnswers = customAnswers + (field to it) },
                        label = { Text(field + strings.getString(R.string.required_suffix)) },
                        placeholder = { Text(strings.getString(R.string.custom_field_answer)) },
                        supportingText = { Text("${customAnswers[field].orEmpty().length}/1000") },
                        isError = customAnswers[field].orEmpty().trim().length > 1000,
                        minLines = 2,
                        maxLines = 6,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
            CheckRow(strings.getString(R.string.confirm_consent), consent) { consent = it }
            Button(
                enabled =
                    consent &&
                        !busy &&
                        t.customFields.all { customAnswers[it].orEmpty().trim().length in 1..1000 },
                onClick = {
                    scope.launch {
                        busy = true
                        try {
                            model.api.raw(
                                "/v1/applications",
                                "POST",
                                buildJsonObject {
                                        put("taskId", id)
                                        put("fields", JsonArray(fields.map { JsonPrimitive(it) }))
                                        put(
                                            "contactFields",
                                            JsonArray(contacts.map { JsonPrimitive(it) }),
                                        )
                                        put("consentVersion", 1)
                                        put(
                                            "customAnswers",
                                            buildJsonObject {
                                                t.customFields.forEach {
                                                    put(it, customAnswers[it].orEmpty())
                                                }
                                            },
                                        )
                                    }
                                    .toString(),
                            )
                            model.refreshPrivate()
                            done()
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
                    if (busy) strings.getString(R.string.submitting)
                    else strings.getString(R.string.confirm_application)
                )
            }
        }
            ?: if (state.failure != null) {
                Text(state.failure.orEmpty())
                Button(
                    onClick = { state.load(model.api, id, strings.apiLanguage(), retry = true) }
                ) {
                    Text(strings.getString(R.string.retry))
                }
            } else CircularProgressIndicator()
    }
}

@Composable
fun CheckRow(
    label: String,
    checked: Boolean,
    enabled: Boolean = true,
    onChange: (Boolean) -> Unit,
) {
    Row(
        Modifier.fillMaxWidth()
            .heightIn(min = 48.dp)
            .toggleable(
                value = checked,
                enabled = enabled,
                role = Role.Checkbox,
                onValueChange = onChange,
            ),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, Modifier.weight(1f))
        Checkbox(checked = checked, onCheckedChange = null, enabled = enabled)
    }
}
