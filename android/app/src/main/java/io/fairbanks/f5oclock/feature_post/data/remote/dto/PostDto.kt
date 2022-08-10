package io.fairbanks.f5oclock.feature_post.data.remote.dto

import io.fairbanks.f5oclock.feature_post.domain.model.Post

// PostInfo DataTransferObject
data class PostDto(
    val __v: Int,
    val _id: String,
    val author: String,
    val commentCount: Int,
    val commentLink: String,
    val created_utc: Int,
    val domain: String,
    val fetchedAt: String,
    val gallery_data: Any,
    val is_gallery: Any,
    val is_self: Boolean,
    val is_video: Boolean,
    val media: Any,
    val media_metadata: Any,
    val post_hint: String,
    val rpan_video: Any,
    val selftext: String,
    val selftext_html: Any,
    val sub: String,
    val thumbnail: String,
    val title: String,
    val upvoteCount: Int,
    val upvote_ratio: Double,
    val url: String
) {
    fun toPost(): Post {
        return Post(
            author = author,
            commentCount = commentCount,
            commentLink = commentLink,
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