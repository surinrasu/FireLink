package cn.firelink.app

import java.time.LocalDate
import java.time.Period
import java.time.ZoneId
import kotlinx.serialization.Serializable

@Serializable
data class ContentBlock(
    val type: String,
    val text: String? = null,
    val url: String? = null,
    val rows: List<List<String>>? = null,
    val latitude: Double? = null,
    val longitude: Double? = null,
    val annotations: List<MapAnnotation>? = null,
)

@Serializable
data class MapCoordinate(val latitude: Double, val longitude: Double)

@Serializable
data class MapAnnotation(val type: String, val coordinates: List<MapCoordinate>)

@Serializable
data class Organizer(
    val id: String,
    val name: String,
    val verified: Boolean,
    val contacts: List<OrganizerContact> = emptyList(),
)

@Serializable data class OrganizerContact(val type: String, val label: String, val value: String)

@Serializable data class IdentityExample(val realName: String, val idNumber: String)

@Serializable
data class TaskSummary(
    val id: String,
    val incidentId: String,
    val title: String,
    val summary: String,
    val status: String,
    val updatedAt: String,
)

@Serializable
data class Incident(
    val id: String,
    val title: String,
    val region: String,
    val latitude: Double,
    val longitude: Double,
    val status: String,
    val updatedAt: String,
    val tasks: List<TaskSummary>,
)

@Serializable
data class RescueTask(
    val id: String,
    val incidentId: String,
    val title: String,
    val summary: String,
    val status: String,
    val updatedAt: String,
    val organizer: Organizer,
    val blocks: List<ContentBlock>,
    val requiredFields: List<String>,
    val contactFields: List<String>,
    val customFields: List<String> = emptyList(),
)

@Serializable
data class Article(
    val id: String,
    val title: String,
    val summary: String,
    val category: String,
    val minutes: Int,
    val blocks: List<ContentBlock>,
)

@Serializable
data class Contacts(val phone: String, val wechat: String = "", val email: String = "")

@Serializable
data class Profile(
    val id: String,
    val username: String,
    val pronouns: String,
    val realName: String,
    val birthDate: String,
    val gender: String,
    val verified: Boolean,
    val region: String,
    val body: String,
    val equipment: List<String>,
    val contacts: Contacts,
    val equipmentDetails: Map<String, String> = emptyMap(),
    val equipmentDescription: String? = null,
    val vehicles: Map<String, Int> = emptyMap(),
) {
    fun equipmentText(label: (String) -> String): String =
        equipmentDescription
            ?: equipment.joinToString("\n") { key ->
                val fields =
                    if (key == "vehicle") listOf("vehiclePassengers", "vehicleCargo")
                    else listOf(key)
                val text =
                    fields
                        .mapNotNull { equipmentDetails[it] }
                        .filter { it.isNotEmpty() }
                        .joinToString("；")
                if (text.isEmpty()) label(key) else "${label(key)}：$text"
            }

    val age: Int
        get() =
            Period.between(
                    LocalDate.parse(birthDate),
                    if (BuildConfig.DEMO_MODE) DemoMode.today
                    else LocalDate.now(ZoneId.of("Asia/Shanghai")),
                )
                .years
}

@Serializable
data class Credential(
    val id: String,
    val title: String,
    val filename: String,
    val status: String,
    val createdAt: String,
)

@Serializable
data class ApplicationRecord(
    val id: String,
    val taskId: String,
    val taskTitle: String,
    val organizerName: String,
    val status: String,
    val contactFields: List<String>,
    val contactsReleased: Boolean,
    val createdAt: String,
    val updatedAt: String,
    val response: String? = null,
) {
    val statusLabel: Int?
        get() =
            mapOf(
                "pending" to R.string.application_pending,
                "accepted" to R.string.application_accepted,
                "rejected" to R.string.application_rejected,
                "withdrawn" to R.string.application_withdrawn,
                "expired" to R.string.application_expired,
            )[status]
}

@Serializable
data class Notice(
    val id: String,
    val title: String,
    val body: String,
    val applicationId: String? = null,
    val createdAt: String,
    val readAt: String? = null,
)

@Serializable
data class ServerConfig(
    val mockAuth: Boolean,
    val passkeys: Boolean,
    val region: String,
    val consentVersion: Int,
    val mockIdentity: IdentityExample? = null,
    val demo: Boolean = false,
)

@Serializable
data class AuthResult(
    val token: String? = null,
    val profile: Profile? = null,
    val registrationToken: String? = null,
    val needsRegistration: Boolean? = null,
)

@Serializable
data class SMSResult(val challengeId: String, val mockCode: String? = null, val message: String)

val fieldLabels =
    linkedMapOf(
        "username" to R.string.username,
        "pronouns" to R.string.pronouns,
        "realName" to R.string.real_name,
        "age" to R.string.age,
        "gender" to R.string.gender,
        "region" to R.string.region,
        "body" to R.string.physical_information,
        "equipment" to R.string.equipment,
        "vehicles" to R.string.vehicles,
        "skills" to R.string.skills,
        "phone" to R.string.phone,
        "wechat" to R.string.wechat,
        "email" to R.string.email,
    )
val legacyEquipmentLabels =
    mapOf(
        "vehicle" to R.string.vehicle,
        "firstAid" to R.string.first_aid,
        "tools" to R.string.tools,
        "protective" to R.string.protective_equipment,
    )
val vehicleLabels =
    linkedMapOf(
        "motorcycle" to R.string.vehicle_motorcycle,
        "cargoTricycle" to R.string.vehicle_cargo_tricycle,
        "sedan" to R.string.vehicle_sedan,
        "offRoad" to R.string.vehicle_off_road,
        "cargoVan" to R.string.vehicle_cargo_van,
    )

enum class IncidentSort(val label: Int) {
    UPDATED(R.string.sort_updated),
    OLDEST(R.string.sort_oldest),
    RECRUITING(R.string.sort_recruiting);

    fun apply(incidents: List<Incident>): List<Incident> =
        when (this) {
            UPDATED ->
                incidents.sortedWith(
                    compareByDescending<Incident> { it.updatedAt }.thenBy { it.id }
                )
            OLDEST -> incidents.sortedWith(compareBy<Incident> { it.updatedAt }.thenBy { it.id })
            RECRUITING ->
                incidents.sortedWith(
                    compareByDescending<Incident> { it.tasks.count { t -> t.status == "open" } }
                        .thenByDescending { it.updatedAt }
                        .thenBy { it.id }
                )
        }
}
