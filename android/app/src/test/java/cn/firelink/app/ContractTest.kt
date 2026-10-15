package cn.firelink.app

import kotlinx.serialization.json.Json
import org.junit.Assert.*
import org.junit.Test

class ContractTest {
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
