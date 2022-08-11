package io.fairbanks.f5oclock.feature_post.presentation

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.Card
import androidx.compose.material.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.fairbanks.f5oclock.feature_post.domain.model.Post

@Composable
fun PostItem(
    post: Post
) {

    Column(
        modifier = Modifier
            .fillMaxWidth()
    ) {
        Text(
            text = post.title,
            fontSize = 18.sp
        )
        Text(
            text = post.url,
            fontSize = 10.sp,
        )
        Text(
            buildAnnotatedString {
                withStyle(style = SpanStyle(fontWeight = FontWeight.W900)) {
                    append(post.commentCount.toString())
                }
                append(" comments")
            }
        )
        Text(
            buildAnnotatedString {
                withStyle(style = SpanStyle(fontWeight = FontWeight.W900)) {
                    append(post.upvoteCount.toString())
                }
                append(" upvotes")
            }
        )
        Text(
            text = post.commentLink,
            fontSize = 10.sp
        )
    }

}