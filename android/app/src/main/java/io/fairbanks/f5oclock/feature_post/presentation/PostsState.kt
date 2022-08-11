package io.fairbanks.f5oclock.feature_post.presentation

import io.fairbanks.f5oclock.feature_post.domain.model.Post

data class PostsState (
    val posts: List<Post> = emptyList(),
    val isLoading: Boolean = false
)