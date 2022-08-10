package io.fairbanks.f5oclock.feature_post.presentation
import androidx.compose.runtime.State
import androidx.compose.runtime.mutableStateOf
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import javax.inject.Inject
import dagger.hilt.android.lifecycle.HiltViewModel
import io.fairbanks.f5oclock.core.util.Resource
import io.fairbanks.f5oclock.feature_post.domain.use_case.GetPosts
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.launch

@HiltViewModel
class PostViewModel @Inject constructor (
    private val getPosts: GetPosts
) : ViewModel() {

    private val _sub = mutableStateOf("")
    val sub: State<String> = _sub

    private val _state = mutableStateOf(PostsState())
    val state: State<PostsState> = _state

    private val _eventFlow = MutableSharedFlow<UIEvent>()
    val eventFlow = _eventFlow.asSharedFlow()

    private var selectSubJob: Job? = null

    fun onSelectSub(selectedSub: String) {
        _sub.value = selectedSub
        selectSubJob?.cancel()
        selectSubJob = viewModelScope.launch {
            delay(500L)
            getPosts(selectedSub)
                .onEach { result ->
                    when(result) {
                        is Resource.Success -> {
                            _state.value = state.value.copy(
                                posts = result.data ?: emptyList(),
                                isLoading = false
                            )
                        }
                        is Resource.Error -> {
                            _state.value = state.value.copy(
                                posts = result.data ?: emptyList(),
                                isLoading = false
                            )
                        }
                        is Resource.Loading -> {
                            _state.value = state.value.copy(
                                posts = result.data ?: emptyList(),
                                isLoading = true
                            )
                        }
                    }
                }.launchIn(this)
        }
    }

    sealed class UIEvent {
        data class ShowSnackBar(val message: String): UIEvent()
    }
}