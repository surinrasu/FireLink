package cn.firelink.app

import kotlinx.serialization.json.Json
import org.junit.Assert.*
import org.junit.Test

class ContractTest {
    @Test
    fun vehiclesAndEquipmentPreserveLegacyTextAndRoundTrip() {
        val legacy =
            """{"id":"test","username":"Test","pronouns":"","realName":"Test","birthDate":"2000-01-01","gender":"","verified":true,"region":"","body":"","equipment":["vehicle"],"contacts":{"phone":"13800000000","wechat":"","email":""}}"""
        val profile = Json.decodeFromString<Profile>(legacy)
        assertTrue(profile.equipmentDetails.isEmpty())
        val updated =
            profile.copy(
                equipmentDetails = mapOf("vehiclePassengers" to "4 人", "vehicleCargo" to "500 升"),
                vehicles = mapOf("motorcycle" to 2, "sedan" to 1),
            )
        assertEquals(
            updated.equipmentDetails,
            Json.decodeFromString<Profile>(Json.encodeToString(updated)).equipmentDetails,
        )
        assertTrue(updated.equipmentText { it }.contains("4 人"))
        assertTrue(updated.equipmentText { it }.contains("500 升"))
        assertTrue(profile.vehicles.isEmpty())
        val freeText = updated.copy(equipmentDescription = "帐篷、手套\n任意内容")
        val restored = Json.decodeFromString<Profile>(Json.encodeToString(freeText))
        assertEquals(freeText.equipmentDescription, restored.equipmentText { it })
        assertEquals(freeText.vehicles, restored.vehicles)
        assertEquals("", updated.copy(equipmentDescription = "").equipmentText { it })
    }

    @Test
    fun sharedApplicationContractPreservesDisclosureStates() {
        val payload =
            javaClass.classLoader!!
                .getResourceAsStream("application-results.json")!!
                .bufferedReader()
                .use { it.readText() }
        val records =
            Json { ignoreUnknownKeys = true }.decodeFromString<List<ApplicationRecord>>(payload)
        assertEquals(
            listOf(
                R.string.application_pending,
                R.string.application_accepted,
                R.string.application_rejected,
                R.string.application_withdrawn,
            ),
            records.map { it.statusLabel },
        )
        assertEquals(listOf("accepted"), records.filter { it.contactsReleased }.map { it.status })
        assertEquals(listOf("phone"), records.first().contactFields)
        assertNull(records.first().response)
        assertNotNull(records[1].response)
    }

    @Test
    fun sortingCountsOnlyOpenTasksAndBreaksTiesConsistently() {
        val payload =
            javaClass.classLoader!!
                .getResourceAsStream("incident-sorting.json")!!
                .bufferedReader()
                .use { it.readText() }
        val incidents = Json { ignoreUnknownKeys = true }.decodeFromString<List<Incident>>(payload)
        assertEquals(
            listOf("incident-closed", "incident-hangzhou", "incident-nanjing"),
            IncidentSort.UPDATED.apply(incidents).map { it.id },
        )
        assertEquals("incident-nanjing", IncidentSort.OLDEST.apply(incidents).first().id)
        assertEquals(
            listOf("incident-hangzhou", "incident-nanjing", "incident-closed"),
            IncidentSort.RECRUITING.apply(incidents).map { it.id },
        )
    }
}
