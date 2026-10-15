package cn.firelink.app

import kotlinx.serialization.json.Json
import org.junit.Assert.*
import org.junit.Test

class RegionTest {
    private val catalog =
        RegionCatalog(
            Json.decodeFromString<List<RegionNode>>(
                javaClass.classLoader!!.getResourceAsStream("regions.json")!!.bufferedReader().use {
                    it.readText()
                }
            )
        )

    @Test
    fun bundledRegionsAndExistingValues() {
        assertEquals(31, catalog.provinces.size)
        assertTrue(catalog.provinces.all { it.children.isNotEmpty() })
        for (region in listOf("浙江省 杭州市 西湖区", "浙江省/杭州市/西湖区", "浙江省杭州市西湖区")) {
            assertEquals(listOf("33", "3301", "330106"), catalog.selection(region).map { it.code })
        }
        assertEquals("110101", catalog.selection("北京市 市辖区 东城区").last().code)
        assertEquals("469002", catalog.selection("海南省 省直辖县级行政区划 琼海市").last().code)
        assertTrue(catalog.selection("Hangzhou").isEmpty())
        assertTrue(catalog.selection("").isEmpty())
    }

    @Test
    fun changingParentClearsDescendants() {
        val original = "浙江省 杭州市 西湖区"
        val jiangsu = catalog.provinces.first { it.name == "江苏省" }
        assertEquals("江苏省", catalog.replacing(original, 0, jiangsu))
        val ningbo =
            catalog.provinces.first { it.name == "浙江省" }.children.first { it.name == "宁波市" }
        assertEquals("浙江省 宁波市", catalog.replacing(original, 1, ningbo))
        assertEquals("浙江省 杭州市", catalog.replacing(original, 2, null))
        assertEquals("", catalog.replacing(original, 0, null))
        assertEquals("江苏省", catalog.replacing("Hangzhou", 0, jiangsu))
    }
}
