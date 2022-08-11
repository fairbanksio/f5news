package io.fairbanks.f5oclock

import android.content.res.Resources
import androidx.appcompat.app.AppCompatActivity
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment

import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

import androidx.hilt.navigation.compose.hiltViewModel
import dagger.hilt.android.AndroidEntryPoint
import de.jensklingenberg.jetpackcomposeplayground.mysamples.github.material.dropdown.SubredditDropdown
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
                        ){

                            SubredditDropdown(
                                items = listOf(
                                    //eventually get this from API via baseurl/subreddits
                                    "politics",
                                    "all",
                                    "news",
                                    "worldnews",
                                    "UkrainianConflict",
                                    "CryptoCurrency"
                                ),
                                selected = viewModel.sub.value,
                                onSubredditSelect = viewModel::onSelectSub
                            )

                            LazyColumn(
                                modifier = Modifier.fillMaxSize()
                                    .padding(10.dp)

                            ) {
                                items(state.posts.size){ i ->
                                    val post = state.posts[i]
                                    if(i > 0){
                                        Spacer(
                                            modifier = Modifier.height(10.dp)
                                        )
                                    }

                                    PostItem(post = post)

                                    if(i < state.posts.size -1){
                                        Spacer(
                                            modifier = Modifier.height(10.dp)
                                        )
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