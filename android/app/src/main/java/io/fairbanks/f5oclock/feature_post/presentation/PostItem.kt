package io.fairbanks.f5oclock.feature_post.presentation

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material.Text
import androidx.compose.material.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat.startActivity
import io.fairbanks.f5oclock.core.util.TimeAgo
import io.fairbanks.f5oclock.feature_post.domain.model.Post


@Composable
fun PostItem(
    post: Post
) {
    val context = LocalContext.current
    Column(
        modifier = Modifier
            .fillMaxWidth()
    ) {

        TextButton(
            onClick = {
                val uri = Uri.parse(post.url) // missing 'http://' will cause crashed
                val intent = Intent(Intent.ACTION_VIEW, uri)
                startActivity(context,intent, null)
            }
        ) {
            Text(
                text = post.title + " (" + post.domain + ")",
                fontSize = 18.sp
            )
        }

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

        val timeAgo: String? = TimeAgo().covertTimeToText((post.created_utc * 1000L))
        Text(
            text = timeAgo!!,
            fontSize = 10.sp
        )

    }

}