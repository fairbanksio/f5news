package io.fairbanks.f5oclock

import SubredditDropdown
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Share
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment

import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

import androidx.hilt.navigation.compose.hiltViewModel
import dagger.hilt.android.AndroidEntryPoint
import io.fairbanks.f5oclock.feature_post.presentation.PostItem
import io.fairbanks.f5oclock.feature_post.presentation.PostViewModel
import kotlinx.coroutines.flow.collectLatest

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    var initialLoad: Boolean = true
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            F5Theme () {
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

                if(initialLoad){
                    viewModel.onSelectSub("politics")
                    initialLoad = false
                }

                Scaffold(
                    scaffoldState = scaffoldState,
                    content = {
                        Box(
                            modifier = Modifier
                                .padding(it)
                        ) {
                            Column (
                                modifier = Modifier
                                    .fillMaxSize()
                            ){
                                TopAppBar(
                                    elevation = 4.dp,
                                    title = {
                                        Text("F5 News")
                                    },
                                    backgroundColor =  MaterialTheme.colors.primarySurface
                                    , actions = {
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

                                    })



                                LazyColumn(
                                    modifier = Modifier.fillMaxSize()

                                ) {
                                    items(state.posts.size){ i ->
                                        val post = state.posts[i]

                                        PostItem(post = post)

                                        if(i < state.posts.size -1){

                                            Divider(color = Color(0xFF2d3748))
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
}