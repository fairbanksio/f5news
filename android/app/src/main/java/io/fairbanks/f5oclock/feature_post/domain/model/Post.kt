package io.fairbanks.f5oclock.feature_post.domain.model

data class Post(
    val author: String,
    val commentCount: Int,
    val commentLink: String,
    val domain: String,
    val fetchedAt: String,
    val sub: String,
    val thumbnail: String?,
    val title: String,
    val upvoteCount: Int,
    val upvote_ratio: Double,
    val url: String
)
