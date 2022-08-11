package io.fairbanks.f5oclock.feature_post.data.local.entity

import androidx.room.Entity
import androidx.room.PrimaryKey
import io.fairbanks.f5oclock.feature_post.domain.model.Post

@Entity
data class PostEntity(
    val author: String,
    val commentCount: Int,
    val commentLink: String,
    val created_utc: Int,
    val domain: String,
    val fetchedAt: String,
    val sub: String,
    val thumbnail: String?,
    val title: String,
    val upvoteCount: Int,
    val upvote_ratio: Double,
    val url: String,
    val _id: String,
    @PrimaryKey val id: Int? = null,
) {
    fun toPost(): Post {
        return Post(
            _id = _id,
            author = author,
            commentCount = commentCount,
            commentLink = commentLink,
            created_utc = created_utc,
            domain = domain,
            fetchedAt = fetchedAt,
            sub = sub,
            thumbnail = thumbnail,
            title = title,
            upvoteCount = upvoteCount,
            upvote_ratio = upvote_ratio,
            url = url
        )
    }
}
