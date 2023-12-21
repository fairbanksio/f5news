package io.fairbanks.f5oclock.feature_post.domain.use_case

import io.fairbanks.f5oclock.core.util.Resource
import io.fairbanks.f5oclock.feature_post.domain.model.Post
import io.fairbanks.f5oclock.feature_post.domain.repository.PostRepository
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow

class GetPosts (
    private val repository: PostRepository
        ) {
    operator fun invoke(sub: String): Flow<Resource<List<Post>>> {
        if (sub.isBlank()){
            return flow {}
        }
        return repository.getPosts(sub)
    }
}