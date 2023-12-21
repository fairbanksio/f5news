package io.fairbanks.f5oclock.feature_post.domain.model

data class PostResponse(
    val posts:List<Post>,
    val count: Int,
    val success: Boolean
)
