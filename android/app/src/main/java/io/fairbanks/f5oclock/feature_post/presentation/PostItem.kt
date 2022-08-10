package io.fairbanks.f5oclock.feature_post.presentation

import androidx.compose.foundation.layout.Column
import androidx.compose.material.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.sp
import io.fairbanks.f5oclock.feature_post.domain.model.Post

@Composable
fun PostItem(
    post: Post,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier
    ) {
        Text(
            text = post.title,
            fontSize = 24.sp
        )
    }
}