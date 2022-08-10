package io.fairbanks.f5oclock

import android.content.res.Resources
import androidx.appcompat.app.AppCompatActivity
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.*

import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

import androidx.hilt.navigation.compose.hiltViewModel
import dagger.hilt.android.AndroidEntryPoint
import io.fairbanks.f5oclock.feature_post.presentation.PostItem
import io.fairbanks.f5oclock.feature_post.presentation.PostViewModel
import kotlinx.coroutines.flow.collectLatest

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            val viewModel: PostViewModel = hiltViewModel()
            val state = viewModel.state.value
            val scaffoldState = rememberScaffoldState()

            LaunchedEffect(key1 = true) {
                viewModel.eventFlow.collectLatest { event ->
                    when(event){
                        is PostViewModel.UIEvent.ShowSnackBar ->{
                            scaffoldState.snackbarHostState.showSnackbar(message = event.message)
                        }
                    }
                }
            }

            Scaffold(
                scaffoldState = scaffoldState,
                content = {
                    Box(
                        modifier = Modifier
                            .padding(it)
                            .background(color = MaterialTheme.colors.background)
                    ) {
                        Column (
                            modifier = Modifier
                                .fillMaxSize()
                                .padding(16.dp)
                        ){
                            TextField(
                                value = viewModel.sub.value,
                                onValueChange = viewModel::onSelectSub,
                                modifier = Modifier.fillMaxWidth(),
                                placeholder = {
                                    Text(text = "Sub..")
                                }
                            )
                            Spacer(
                                modifier = Modifier.height(16.dp)
                            )
                            LazyColumn(
                                modifier = Modifier.fillMaxSize()

                            ) {
                                items(state.posts.size){ i ->
                                    val post = state.posts[i]
                                    if(i > 0){
                                        Spacer(
                                            modifier = Modifier.height(8.dp)
                                        )
                                    }
                                    PostItem(post = post, modifier = Modifier.padding(4.dp))
                                    if(i < state.posts.size -1){
                                        Divider()
                                    }
                                }
                            }
                        }
                    }
                }
            )

        }
    }
}