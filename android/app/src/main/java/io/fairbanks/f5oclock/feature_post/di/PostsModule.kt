package io.fairbanks.f5oclock.feature_post.di

import android.app.Application
import androidx.room.Room
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import io.fairbanks.f5oclock.feature_post.data.local.F5ContentDatabase
import io.fairbanks.f5oclock.feature_post.data.local.PostDao
import io.fairbanks.f5oclock.feature_post.data.remote.F5Api
import io.fairbanks.f5oclock.feature_post.data.repository.PostRepositoryImpl
import io.fairbanks.f5oclock.feature_post.domain.repository.PostRepository
import io.fairbanks.f5oclock.feature_post.domain.use_case.GetPosts
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import javax.inject.Singleton


@Module
@InstallIn(SingletonComponent::class)
object PostsModule {

    @Provides
    @Singleton
    fun provideGetPostsUseCase(repository: PostRepository): GetPosts {
        return GetPosts(repository)
    }

    @Provides
    @Singleton
    fun providePostsRepository(
        db: F5ContentDatabase,
        api: F5Api
    ): PostRepository {
        return PostRepositoryImpl(api, db.dao)
    }

    @Provides
    @Singleton
    fun providePostDatabase(app: Application): F5ContentDatabase {
        return Room.databaseBuilder(
            app, F5ContentDatabase::class.java, "f5_db"
        ).build()
    }

    @Provides
    @Singleton
    fun providePostApi(): F5Api {
        return Retrofit.Builder()
            .baseUrl(F5Api.BASE_URL)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
            .create(F5Api::class.java)
    }
}