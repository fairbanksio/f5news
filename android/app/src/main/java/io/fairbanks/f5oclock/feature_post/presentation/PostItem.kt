package io.fairbanks.f5oclock.feature_post.presentation

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material.Icon
import androidx.compose.material.MaterialTheme
import androidx.compose.material.Text
import androidx.compose.material.TextButton
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.Comment
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.outlined.Timer
import androidx.compose.material.icons.outlined.Timer10
import androidx.compose.material.icons.rounded.Info
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat.startActivity
import io.fairbanks.f5oclock.core.util.TimeAgo
import io.fairbanks.f5oclock.feature_post.domain.model.Post

@Composable
fun bgColorFromUpvotes(upvotes: Int) : Color {
    if(upvotes in 100..250){
        return Color(0xFF161938)
    } else if (upvotes in 251..500){
        return Color(0xFF16284f)
    } else  if (upvotes >= 501){
        return Color(0xFF1a365d)
    }

    return MaterialTheme.colors.background

}

@Composable
fun PostItem(
    post: Post
) {
    val context = LocalContext.current
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(bgColorFromUpvotes(upvotes = post.upvoteCount))
            .padding(bottom = 5.dp, top = 5.dp, start = 10.dp, end = 10.dp)
    ) {

        TextButton(
            onClick = {
                val uri = Uri.parse(post.url) // missing 'http://' will cause crashed
                val intent = Intent(Intent.ACTION_VIEW, uri)
                startActivity(context,intent, null)
            }
        ) {
            Text(
                text = post.title,
                fontSize = 14.sp
            )
        }
        Row(

            modifier= Modifier
                .padding(start=5.dp)
                .clickable(
true
                ){
                    val uri = Uri.parse("https://reddit.com" + post.commentLink) // missing 'http://' will cause crashed
                    val intent = Intent(Intent.ACTION_VIEW, uri)
                    startActivity(context,intent, null)
                }
        ) {

            Icon(
                imageVector = Icons.Filled.ArrowUpward,
                contentDescription = "Localized description",
                modifier = Modifier.size(16.dp)
            )
            Text(
                text = post.upvoteCount.toString(),
                fontSize = 12.sp
            )

            Spacer(Modifier.width(10.dp))

            Icon(
                imageVector = Icons.Outlined.Comment,
                contentDescription = "Localized description",
                modifier = Modifier.size(16.dp)
            )
            Text(
                text = post.commentCount.toString(),
                fontSize = 12.sp
            )

            Spacer(Modifier.width(10.dp))

            Icon(
                imageVector = Icons.Outlined.Timer,
                contentDescription = "Localized description",
                modifier = Modifier.size(16.dp)
            )
            val timeAgo: String? = TimeAgo().covertTimeToText((post.created_utc * 1000L))
            Text(
                text = timeAgo!!,
                fontSize = 12.sp
            )


            Spacer(Modifier.width(10.dp))

            Icon(
                imageVector = Icons.Outlined.Link,
                contentDescription = "Localized description",
                modifier = Modifier.size(16.dp)
            )
            Text(
                text = post.domain,
                fontSize = 12.sp
            )
        }
        Spacer(Modifier.height(10.dp))




    }

}