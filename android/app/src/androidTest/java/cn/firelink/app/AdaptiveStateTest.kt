package cn.firelink.app

import android.app.Application
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test

/** Real screens, restored with their SaveableStateRegistry; all network traffic stays local. */
class AdaptiveStateTest {
    @get:Rule val compose = createComposeRule()
    private val context
        get() = InstrumentationRegistry.getInstrumentation().targetContext

    private val strings
        get() = context.resources

    private lateinit var server: MockWebServer
    private lateinit var model: AppModel
    private val task =
        RescueTask(
            "adaptive-task",
            "adaptive-incident",
            "Adaptive task",
            "Summary",
            "open",
            "2026-01-01T00:00:00Z",
            Organizer(
                "organizer",
                "Test organizer",
                true,
                listOf(OrganizerContact("phone", "Coordinator", "13800000000")),
            ),
            emptyList(),
            listOf("username"),
            listOf("phone"),
            listOf("Availability"),
        )

    @Before
    fun setup() {
        server = MockWebServer()
        server.start()
        model = AppModel(context.applicationContext as Application)
        model.api.baseURL = server.url("/").toString().trimEnd('/')
        model.api.token = null
    }

    @After
    fun cleanup() {
        server.shutdown()
    }

    @Test
    fun navigationRestoresTheSelectedTabAndEachHistory() {
        val restoration = StateRestorationTester(compose)
        lateinit var navigator: AppNavigator
        restoration.setContent {
            navigator = rememberAppNavigator()
            Text(navigator.current.path)
        }
        compose.runOnIdle {
            navigator.go("incident/one")
            navigator.go("task/two")
            navigator.go("profile")
            navigator.go("edit")
        }
        restoration.emulateSavedInstanceStateRestore()
        compose.runOnIdle {
            assertEquals("profile", navigator.selected)
            assertEquals("edit", navigator.current.path)
            navigator.go("incidents")
            assertEquals("task/two", navigator.current.path)
            navigator.back()
            assertEquals("incident/one", navigator.current.path)
            navigator.back()
            assertEquals("incidents", navigator.current.path)
            navigator.back()
            assertEquals("home", navigator.current.path)
            navigator.go("history")
            navigator.go("task/two")
            navigator.go("history")
            assertEquals("history", navigator.current.path)
            assertEquals(2, navigator.stack.size)
        }
    }

    @Test
    fun profileDraftSurvivesSavedStateRestoration() {
        val profile =
            Profile(
                "test",
                "Initial",
                "",
                "Tester",
                "2000-01-01",
                "",
                true,
                "",
                "",
                emptyList(),
                Contacts("13800000000"),
            )
        val restoration = StateRestorationTester(compose)
        restoration.setContent { MaterialTheme { ProfileScreen(model, profile) } }
        compose
            .onNode(hasSetTextAction() and hasText(strings.getString(R.string.username)))
            .performTextReplacement("Unsaved profile")
        restoration.emulateSavedInstanceStateRestore()
        compose.onNodeWithText("Unsaved profile").assertExists()
        assertEquals(0, server.requestCount)
    }

    @Test
    fun applicationRestoresOptionalSharingAndCustomAnswersTogether() {
        server.enqueue(MockResponse().setBody(Json.encodeToString(task)))
        val restoration = StateRestorationTester(compose)
        restoration.setContent { MaterialTheme { ApplyScreen(task.id, model, done = {}) } }
        compose.waitUntil(10_000) {
            compose.onAllNodesWithText(task.title).fetchSemanticsNodes().isNotEmpty()
        }
        val body = strings.getString(fieldLabels.getValue("body"))
        val email = strings.getString(fieldLabels.getValue("email"))
        compose.onNodeWithText(body).performScrollTo().performClick()
        compose.onNodeWithText(email).performScrollTo().performClick()
        compose
            .onNode(hasSetTextAction() and hasText("Availability", substring = true))
            .performScrollTo()
            .performTextInput("Saturday afternoon")
        compose
            .onNodeWithText(strings.getString(R.string.confirm_consent))
            .performScrollTo()
            .performClick()
        restoration.emulateSavedInstanceStateRestore()
        compose.onNodeWithText(body).performScrollTo().assertIsOn()
        compose.onNodeWithText(email).performScrollTo().assertIsOn()
        compose.onNodeWithText("Saturday afternoon").performScrollTo().assertExists()
        compose
            .onNodeWithText(strings.getString(R.string.confirm_consent))
            .performScrollTo()
            .assertIsOn()
        compose
            .onNodeWithText(strings.getString(R.string.confirm_application))
            .performScrollTo()
            .assertIsEnabled()
        // Restoring the UI must not submit an application or reload the retained task.
        assertEquals(1, server.requestCount)
    }

    @Test
    fun contactSheetSurvivesSavedStateRestoration() {
        server.enqueue(MockResponse().setBody(Json.encodeToString(task)))
        val restoration = StateRestorationTester(compose)
        restoration.setContent { MaterialTheme { TaskScreen(task.id, model, {}, {}) } }
        compose.waitUntil(10_000) {
            compose.onAllNodesWithText(task.title).fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText(strings.getString(R.string.contact_organizer)).performClick()
        compose.onNodeWithText("Coordinator").assertIsDisplayed()
        restoration.emulateSavedInstanceStateRestore()
        compose.onNodeWithText("Coordinator").assertIsDisplayed()
        assertEquals(1, server.requestCount)
    }
}
