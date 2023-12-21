package io.fairbanks.f5oclock.feature_post.data.remote

import io.fairbanks.f5oclock.feature_post.data.remote.dto.PostResponseDto
import retrofit2.http.GET
import retrofit2.http.Path

interface F5Api {
    @GET("/posts/{subreddit}")
    suspend fun getPosts(
        @Path("subreddit") subreddit: String
    ): PostResponseDto

    companion object {
        const val BASE_URL = "https://api.f5.news"
    }
}