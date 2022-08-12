package io.fairbanks.f5oclock.feature_post.data.repository

import io.fairbanks.f5oclock.core.util.Resource
import io.fairbanks.f5oclock.feature_post.data.local.PostDao
import io.fairbanks.f5oclock.feature_post.data.remote.F5Api
import io.fairbanks.f5oclock.feature_post.domain.model.Post
import io.fairbanks.f5oclock.feature_post.domain.repository.PostRepository
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import retrofit2.HttpException
import java.io.IOException

class PostRepositoryImpl (
    private val api: F5Api,
    private val postDao: PostDao
    ): PostRepository {
    override fun getPosts(sub: String): Flow<Resource<List<Post>>> = flow {

        // emit loading state
        emit(Resource.Loading())

        // get posts from database first
        val cachedPosts = postDao.getPosts(sub).map {it.toPost()}

        // emit cached data with loading state
        emit(Resource.Loading(data = cachedPosts))

        // make api call
        try {
            // get the response
            val remotePostsResponse = api.getPosts(sub).toPostResponse()
            // get posts from response
            val remotePosts = remotePostsResponse.posts


            //clear all posts previously cached for the sub
            postDao.deletePosts(sub)

            // insert newly aquired posts
            postDao.insertPosts(remotePosts.map {it.toPostEntity()})

        } catch(e: HttpException) {
            // there was an error, show it as send old cached data so something can be displayed
            emit(Resource.Error(
                message = "There was an error while communicating with remote server",
                data = cachedPosts
            ))
        } catch(e: IOException) {
            emit(Resource.Error(
                message = "Could not reach server, check your internet connection",
                data = cachedPosts
            ))
        }

        // get fresh data from local db and emit with success response
        val newPosts = postDao.getPosts(sub).map {it.toPost()}
        emit(Resource.Success(data = newPosts))

    }

}