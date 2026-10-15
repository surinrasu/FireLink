package cn.firelink.app

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
data class RegionNode(
    val code: String,
    val name: String,
    val children: List<RegionNode> = emptyList(),
)

class RegionCatalog(val provinces: List<RegionNode>) {
    fun selection(region: String): List<RegionNode> {
        var remaining = normalized(region)
        var options = provinces
        val selected = mutableListOf<RegionNode>()
        while (true) {
            val node = options.firstOrNull { remaining.startsWith(it.name) } ?: break
            selected.add(node)
            remaining = remaining.removePrefix(node.name)
            options = node.children
        }
        return selected
    }

    fun replacing(region: String, level: Int, node: RegionNode?): String =
        (selection(region).take(level) + listOfNotNull(node)).joinToString(" ") { it.name }

    companion object {
        fun normalized(value: String): String =
            value.filterNot { it.isWhitespace() || it == '/' || it == '／' }
    }
}

@Composable
fun RegionPicker(region: String, onChange: (String) -> Unit) {
    val context = LocalContext.current
    val strings = localizedResources()
    val catalog = remember {
        RegionCatalog(
            Json.decodeFromString<List<RegionNode>>(
                context.assets.open("regions.json").bufferedReader().use { it.readText() }
            )
        )
    }
    val selected = catalog.selection(region)
    val labels = listOf(R.string.region_province, R.string.region_city, R.string.region_district)
    labels.forEachIndexed { level, label ->
        val options =
            if (level == 0) catalog.provinces else selected.getOrNull(level - 1)?.children.orEmpty()
        RegionDropdown(
            label = strings.getString(label),
            value = selected.getOrNull(level)?.name.orEmpty(),
            emptyLabel =
                strings.getString(if (level == 0) R.string.not_provided else R.string.region_any),
            options = options,
            onSelect = { onChange(catalog.replacing(region, level, it)) },
        )
    }
    if (
        RegionCatalog.normalized(region) !=
            RegionCatalog.normalized(selected.joinToString("") { it.name })
    ) {
        Text(
            strings.getString(R.string.region_existing, region),
            style = MaterialTheme.typography.bodySmall,
        )
        TextButton(onClick = { onChange("") }) { Text(strings.getString(R.string.region_clear)) }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun RegionDropdown(
    label: String,
    value: String,
    emptyLabel: String,
    options: List<RegionNode>,
    onSelect: (RegionNode?) -> Unit,
) {
    var expanded by remember(options) { mutableStateOf(false) }
    ExposedDropdownMenuBox(
        expanded = expanded,
        onExpandedChange = { if (options.isNotEmpty()) expanded = it },
    ) {
        OutlinedTextField(
            value = value.ifEmpty { emptyLabel },
            onValueChange = {},
            readOnly = true,
            enabled = options.isNotEmpty(),
            label = { Text(label) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded) },
            modifier = Modifier.fillMaxWidth().menuAnchor(MenuAnchorType.PrimaryNotEditable),
        )
        ExposedDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            DropdownMenuItem(
                text = { Text(emptyLabel) },
                onClick = {
                    onSelect(null)
                    expanded = false
                },
            )
            options.forEach { node ->
                DropdownMenuItem(
                    text = { Text(node.name) },
                    onClick = {
                        onSelect(node)
                        expanded = false
                    },
                )
            }
        }
    }
}
