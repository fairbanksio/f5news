package io.fairbanks.f5oclock.feature_post.domain.model

import io.fairbanks.f5oclock.feature_post.data.local.entity.PostEntity

data class Post(
    val _id: String,
    val author: String,
    val commentCount: Int,
    val created_utc: Int,
    val commentLink: String,
    val domain: String,
    val fetchedAt: String,
    val sub: String,
    val thumbnail: String?,
    val title: String,
    val upvoteCount: Int,
    val upvote_ratio: Double,
    val url: String
) {
    fun toPostEntity(): PostEntity {
        return PostEntity(
            _id = _id,
            author = author,
            commentCount = commentCount,
            commentLink = commentLink,
            created_utc = created_utc,
            domain = domain,
            fetchedAt = fetchedAt,
            sub = sub,
            thumbnail = thumbnail!!,
            title = title,
            upvoteCount = upvoteCount,
            upvote_ratio = upvote_ratio,
            url = url
        )
    }
}
