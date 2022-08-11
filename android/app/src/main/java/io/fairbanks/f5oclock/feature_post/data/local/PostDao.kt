package io.fairbanks.f5oclock.feature_post.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import io.fairbanks.f5oclock.feature_post.data.local.entity.PostEntity

@Dao
interface PostDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertPosts(posts: List<PostEntity>)

    @Query("DELETE FROM postentity WHERE _id IN (:ids)")
    suspend fun deletePosts(ids: List<String>)

    @Query("SELECT * FROM postentity WHERE sub LIKE '%' || :sub || '%'")
    suspend fun getPosts(sub: String): List<PostEntity>
}