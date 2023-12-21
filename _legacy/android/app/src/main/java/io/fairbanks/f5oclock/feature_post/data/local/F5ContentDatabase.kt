package io.fairbanks.f5oclock.feature_post.data.local

import androidx.room.Database
import androidx.room.RoomDatabase
import io.fairbanks.f5oclock.feature_post.data.local.entity.PostEntity

@Database(
    entities = [PostEntity::class],
    version = 1
)

abstract class F5ContentDatabase: RoomDatabase() {
    abstract val dao: PostDao
}