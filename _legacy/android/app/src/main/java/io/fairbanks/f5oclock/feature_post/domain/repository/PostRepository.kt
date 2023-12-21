package io.fairbanks.f5oclock.feature_post.domain.repository

import io.fairbanks.f5oclock.core.util.Resource
import io.fairbanks.f5oclock.feature_post.domain.model.Post
import kotlinx.coroutines.flow.Flow

interface PostRepository {
    fun getPosts(sub: String): Flow<Resource<List<Post>>>
}