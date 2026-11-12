package cn.firelink.app

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.material3.adaptive.ExperimentalMaterial3AdaptiveApi
import androidx.compose.material3.adaptive.currentWindowAdaptiveInfo
import androidx.compose.material3.adaptive.layout.calculatePaneScaffoldDirective
import androidx.compose.material3.adaptive.navigation.BackNavigationBehavior
import androidx.compose.material3.adaptive.navigation3.ListDetailSceneStrategy
import androidx.compose.material3.adaptive.navigation3.rememberListDetailSceneStrategy
import androidx.compose.material3.adaptive.navigationsuite.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.navigation3.rememberViewModelStoreNavEntryDecorator
import androidx.navigation3.runtime.*
import androidx.navigation3.ui.NavDisplay
import kotlinx.coroutines.flow.first
import kotlinx.serialization.Serializable

/** Keep the presentation harness's route strings, with serializable navigation state. */
@Serializable
data class AppRoute(val path: String) : NavKey {
    val kind: String
        get() = path.substringBefore('/')

    val id: String
        get() = path.substringAfter('/', "")
}

val rootRoutes = listOf("home", "incidents", "profile")

class AppNavigator(
    val stacks: Map<String, NavBackStack<NavKey>>,
    private val selectedState: MutableState<String>,
) {
    var selected: String by selectedState
    val stack: NavBackStack<NavKey>
        get() = stacks.getValue(selected)

    val current: AppRoute
        get() = stack.last() as AppRoute

    fun go(path: String) {
        // An incident belongs to the browse tab, even when opened from the home overview.
        if (path.startsWith("incident/")) {
            selected = "incidents"
            // Selecting a different row starts a new detail trail; tab switches retain the trail.
            if (current.path == path) return
            while (stack.size > 1) stack.removeAt(stack.lastIndex)
        }
        if (path in rootRoutes) selected = path
        else if (current.path != path) {
            val existing = stack.indexOfLast { (it as AppRoute).path == path }
            if (existing >= 0) {
                // A task can link back to an existing application history entry.
                // Reuse that entry instead of giving two entries the same content key.
                while (stack.lastIndex > existing) stack.removeAt(stack.lastIndex)
            } else stack.add(AppRoute(path))
        }
    }

    fun back() {
        if (stack.size > 1) stack.removeAt(stack.lastIndex) else selected = "home"
    }

    fun home() {
        selected = "home"
        val home = stacks.getValue("home")
        while (home.size > 1) home.removeAt(home.lastIndex)
    }
}

@Composable
internal fun rememberAppNavigator(): AppNavigator {
    val home = rememberNavBackStack(AppRoute("home"))
    val incidents = rememberNavBackStack(AppRoute("incidents"))
    val profile = rememberNavBackStack(AppRoute("profile"))
    val selected = rememberSaveable { mutableStateOf("home") }
    return remember {
        AppNavigator(
            mapOf("home" to home, "incidents" to incidents, "profile" to profile),
            selected,
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3AdaptiveApi::class)
@Composable
fun FireLink(
    model: AppModel = viewModel(),
    initialRoute: String = "home",
    demoReadyToken: String? = null,
) {
    val strings = localizedResources()
    LaunchedEffect(strings.apiLanguage()) { model.load() }
    val nav = rememberAppNavigator()
    var pending by rememberSaveable { mutableStateOf("profile") }
    var demoNavigated by rememberSaveable { mutableStateOf(false) }
    var demoContentRoute by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(model.loading, model.incidents) {
        if (
            BuildConfig.DEMO_MODE &&
                !demoNavigated &&
                !model.loading &&
                model.incidents.isNotEmpty()
        ) {
            demoNavigated = true
            nav.go(initialRoute)
        }
    }
    val view = LocalView.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val dark = isSystemInDarkTheme()
    val route = nav.current
    val demoReady =
        demoNavigated &&
            !model.loading &&
            model.error == null &&
            route.path == initialRoute &&
            (route.kind !in listOf("task", "apply") || demoContentRoute == initialRoute)
    LaunchedEffect(demoReadyToken, demoReady, route, dark) {
        if (BuildConfig.DEMO_MODE && demoReadyToken != null && demoReady) {
            lifecycle.currentStateFlow.first { it == Lifecycle.State.RESUMED }
            withFrameNanos {}
            DemoMode.reportReady(view, demoReadyToken, initialRoute, dark)
        }
    }
    fun requireLogin(path: String) {
        if (model.profile != null) nav.go(path)
        else {
            pending = path
            nav.go("login")
        }
    }

    val adaptiveInfo = currentWindowAdaptiveInfo()
    val suiteType = NavigationSuiteScaffoldDefaults.calculateFromAdaptiveInfo(adaptiveInfo)
    val showNavigation = route.path in rootRoutes || suiteType != NavigationSuiteType.NavigationBar
    val suiteState = rememberNavigationSuiteScaffoldState()
    LaunchedEffect(showNavigation) { if (showNavigation) suiteState.show() else suiteState.hide() }
    NavigationSuiteScaffold(
        layoutType = suiteType,
        state = suiteState,
        navigationSuiteItems = {
            listOf(
                    Triple("home", R.string.home, Icons.Outlined.Home),
                    Triple("incidents", R.string.incidents, Icons.Outlined.Map),
                    Triple("profile", R.string.account, Icons.Outlined.Person),
                )
                .forEach { (path, label, icon) ->
                    item(
                        selected = nav.selected == path,
                        onClick = { if (path == "profile") requireLogin(path) else nav.go(path) },
                        icon = { Icon(icon, strings.getString(label)) },
                        label = {
                            Text(
                                strings.getString(label),
                                modifier = Modifier.widthIn(max = 128.dp).padding(horizontal = 8.dp),
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                                textAlign = TextAlign.Center,
                            )
                        },
                    )
                }
        },
    ) {
        BoxWithConstraints(Modifier.fillMaxSize()) {
            val fontScale = LocalDensity.current.fontScale.coerceAtLeast(1f)
            // Account for the rail's occupied width and large text, not the physical display.
            val baseDirective = calculatePaneScaffoldDirective(adaptiveInfo)
            val twoPanes =
                baseDirective.maxHorizontalPartitions > 1 && maxWidth >= (840 * fontScale).dp
            val directive =
                baseDirective.copy(
                    maxHorizontalPartitions = if (twoPanes) 2 else 1,
                    horizontalPartitionSpacerSize = 0.dp,
                    defaultPanePreferredWidth = (360 * fontScale).dp,
                )
            val strategy =
                rememberListDetailSceneStrategy<NavKey>(
                    directive = directive,
                    backNavigationBehavior = BackNavigationBehavior.PopLatest,
                )
            // Decorate every tab, including inactive tabs, so switching tabs keeps drafts and
            // scroll.
            val decorated =
                nav.stacks.mapValues { (root, stack) ->
                    key(root) {
                        rememberDecoratedNavEntries(
                            backStack = stack,
                            entryDecorators =
                                listOf(
                                    rememberSaveableStateHolderNavEntryDecorator(),
                                    rememberViewModelStoreNavEntryDecorator(),
                                ),
                            entryProvider = { key ->
                                val destination = key as AppRoute
                                val metadata =
                                    when (destination.kind) {
                                        "incidents" ->
                                            ListDetailSceneStrategy.listPane(
                                                detailPlaceholder = {
                                                    Box(
                                                        Modifier.fillMaxSize(),
                                                        contentAlignment = Alignment.Center,
                                                    ) {
                                                        EmptyState(
                                                            strings.getString(
                                                                R.string.fire_opportunities
                                                            ),
                                                            strings.getString(
                                                                R.string.select_incident
                                                            ),
                                                        )
                                                    }
                                                }
                                            )
                                        "incident",
                                        "task" -> ListDetailSceneStrategy.detailPane()
                                        else -> emptyMap()
                                    }
                                NavEntry(
                                    key,
                                    contentKey = "$root/${destination.path}",
                                    metadata = metadata,
                                ) {
                                    val inSplit =
                                        twoPanes &&
                                            stack.any { (it as AppRoute).kind == "incidents" } &&
                                            destination.kind in
                                                listOf("incidents", "incident", "task")
                                    DestinationFrame(destination, inSplit, nav::back, model::load) {
                                        when (destination.kind) {
                                            "home" -> HomeScreen(model, nav::go)
                                            "incidents" ->
                                                IncidentsScreen(
                                                    model,
                                                    nav::go,
                                                    selectedIncidentId =
                                                        (stack.last() as AppRoute).let { selected ->
                                                            if (selected.kind == "incident")
                                                                selected.id
                                                            else if (selected.kind == "task")
                                                                model.incidents
                                                                    .firstOrNull { incident ->
                                                                        incident.tasks.any {
                                                                            it.id == selected.id
                                                                        }
                                                                    }
                                                                    ?.id
                                                            else null
                                                        },
                                                )
                                            "incident" ->
                                                IncidentScreen(destination.id, model, nav::go)
                                            "task" ->
                                                TaskScreen(
                                                    destination.id,
                                                    model,
                                                    ::requireLogin,
                                                    nav::go,
                                                    onLoaded = {
                                                        demoContentRoute = destination.path
                                                    },
                                                )
                                            "article" ->
                                                Page {
                                                    model.articles
                                                        .find { it.id == destination.id }
                                                        ?.let {
                                                            Text(
                                                                it.title,
                                                                style =
                                                                    MaterialTheme.typography
                                                                        .headlineMedium,
                                                            )
                                                            ContentBlocks(it.blocks)
                                                        }
                                                }
                                            "login" ->
                                                LoginScreen(model, demoDone = nav::home) {
                                                    nav.back()
                                                    nav.go(pending)
                                                }
                                            "profile" ->
                                                AccountScreen(model, nav::go) {
                                                    pending = "profile"
                                                    nav.go("login")
                                                }
                                            "edit" ->
                                                model.profile?.let { ProfileScreen(model, it) }
                                            "skills" -> SkillsScreen(model)
                                            "history" -> HistoryScreen(model, nav::go)
                                            "notifications" ->
                                                NotificationHistoryScreen(model, nav::go) {
                                                    requireLogin("notifications")
                                                }
                                            "settings" ->
                                                SettingsScreen(model) { requireLogin("passkeys") }
                                            "passkeys" -> PasskeySettingsScreen(model)
                                            "apply" ->
                                                ApplyScreen(
                                                    destination.id,
                                                    model,
                                                    onLoaded = {
                                                        demoContentRoute = destination.path
                                                    },
                                                ) {
                                                    nav.back()
                                                    nav.go("history")
                                                }
                                        }
                                    }
                                }
                            },
                        )
                    }
                }
            val entries =
                if (nav.selected == "home") decorated.getValue("home")
                else decorated.getValue("home") + decorated.getValue(nav.selected)
            NavDisplay(entries = entries, sceneStrategy = strategy, onBack = nav::back)
        }
    }
    model.error?.let { message ->
        AlertDialog(
            onDismissRequest = { model.error = null },
            title = { Text(strings.getString(R.string.notice)) },
            text = { Text(message) },
            confirmButton = {
                TextButton(onClick = { model.error = null }) {
                    Text(strings.getString(R.string.ok))
                }
            },
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DestinationFrame(
    route: AppRoute,
    inSplit: Boolean,
    back: () -> Unit,
    refresh: () -> Unit,
    content: @Composable () -> Unit,
) {
    val strings = localizedResources()
    val title =
        when (route.kind) {
            "incidents" -> R.string.incidents
            "profile" -> R.string.account
            "login" -> R.string.sign_in
            "edit" -> R.string.profile
            "skills" -> R.string.qualifications
            "history" -> R.string.application_history
            "notifications" -> R.string.notification_history
            "passkeys" -> R.string.passkeys
            "settings" -> R.string.settings
            "apply" -> R.string.application_consent
            "task" -> R.string.task_details
            "incident" -> R.string.fire_opportunities
            "article" -> R.string.guides
            else -> null
        }
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(title?.let(strings::getString) ?: "FireLink") },
                navigationIcon = {
                    if (route.path !in rootRoutes && !inSplit)
                        IconButton(onClick = back) {
                            Icon(Icons.Outlined.ArrowBack, strings.getString(R.string.back))
                        }
                },
                actions = {
                    if (inSplit && route.kind == "task")
                        TextButton(onClick = back) { Text(strings.getString(R.string.back)) }
                    if (route.path in rootRoutes)
                        IconButton(onClick = refresh) {
                            Icon(Icons.Outlined.Refresh, strings.getString(R.string.refresh))
                        }
                },
            )
        }
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding).consumeWindowInsets(padding).imePadding()) {
            content()
        }
    }
}

@Composable
private fun IncidentScreen(id: String, model: AppModel, go: (String) -> Unit) {
    val strings = localizedResources()
    Page {
        model.incidents
            .find { it.id == id }
            ?.let { incident ->
                MapPreview(incident.latitude, incident.longitude)
                Text(incident.title, style = MaterialTheme.typography.headlineSmall)
                Text(incident.region)
                SectionTitle(strings.getString(R.string.tasks))
                incident.tasks.forEach { task ->
                    Card(onClick = { go("task/${task.id}") }, modifier = Modifier.fillMaxWidth()) {
                        Column(
                            Modifier.padding(18.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Text(task.title, style = MaterialTheme.typography.titleMedium)
                            Text(task.summary)
                            Text(
                                strings.getString(
                                    if (task.status == "open") R.string.accepting_applications
                                    else R.string.closed
                                ),
                                color = MaterialTheme.colorScheme.primary,
                            )
                        }
                    }
                }
            }
    }
}
