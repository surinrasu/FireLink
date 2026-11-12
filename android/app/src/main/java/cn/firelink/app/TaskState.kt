package cn.firelink.app

import androidx.compose.runtime.*
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

/**
 * Owned by a navigation entry, so resizing a scene does not reload its task or dismiss its sheet.
 */
class TaskState : ViewModel() {
    var task by mutableStateOf<RescueTask?>(null)
        private set

    var failure by mutableStateOf<String?>(null)
        private set

    private var request: Job? = null
    private var loadedKey: String? = null

    fun load(api: Api, id: String, language: String, retry: Boolean = false) {
        val key = "${api.baseURL}/$language/$id"
        if (!retry && loadedKey == key && (task != null || request?.isActive == true)) return
        request?.cancel()
        if (loadedKey != key) task = null
        loadedKey = key
        failure = null
        request =
            viewModelScope.launch {
                try {
                    task = api.get("/v1/tasks/$id")
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    failure = e.message
                }
            }
    }
}
