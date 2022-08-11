package io.fairbanks.f5oclock.feature_post.data.remote.dto

import io.fairbanks.f5oclock.feature_post.domain.model.PostResponse

// PostsResponse DataTransferObject
data class PostResponseDto(
    val count: Int,
    val `data`: List<PostDto>,
    val success: Boolean
) {
    fun toPostResponse(): PostResponse {
        return PostResponse(
            count = count,
            posts = `data`.map { it.toPost() },
            success = success
        )
    }
}
