package io.fairbanks.f5oclock

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material.MaterialTheme
import androidx.compose.material.darkColors
import androidx.compose.material.lightColors
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

// Light Theme
private val DarkColors = darkColors(
    primary = Color(0xFFb5a788),
    primaryVariant = Color(0xFF3700B3),
    secondary= Color(0xFF03DAC6),
    secondaryVariant = Color(0x20FFFFFF),
    background = Color(0xFF171923),
    surface = Color(0xFF171923),
    error = Color(0xFFB00020),
    onPrimary = Color.White,
    onSecondary = Color.Black,
    onBackground = Color(0xFFa0aec0),
    onSurface = Color(0xFFa0aec0),
    onError = Color.White,
)
private val ExtendedDarkColors = ExtendedColors(
    trending = Color(0xFF161938),
    hot = Color(0xFF16284f),
    f5oclock = Color(0xFF1a365d)

)

// Dark Theme
private val LightColors = lightColors(
    primary = Color(0xFF337ab7),
    primaryVariant = Color(0xFF3700B3),
    secondary= Color(0xFF03DAC6),
    secondaryVariant = Color(0xFFe2e8f0),
    background = Color.White,
    surface = Color.White,
    error = Color(0xFFB00020),
    onPrimary = Color.White,
    onSecondary = Color.Black,
    onBackground = Color(0xFF333333),
    onSurface = Color(0xFF333333),
    onError = Color.White,

)
private val ExtendedLightColors = ExtendedColors(
    trending = Color(0xFFffd8b2),
    hot = Color(0xFFffbf7f),
    f5oclock = Color(0xFFffa64c)
)


// Implementation
@Composable
fun F5Theme (
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    val extendedColors = if (darkTheme) ExtendedDarkColors else ExtendedLightColors
    CompositionLocalProvider(LocalExtendedColors provides extendedColors) {
        MaterialTheme(
            colors = if (darkTheme) DarkColors else LightColors,
            /*...*/
            content = content
        )
    }
}
@Immutable
data class ExtendedColors(
    val trending: Color,
    val hot: Color,
    val f5oclock: Color,
)
val LocalExtendedColors = staticCompositionLocalOf {
    ExtendedColors(
        trending = Color.Unspecified,
        hot = Color.Unspecified,
        f5oclock = Color.Unspecified
    )
}

object ExtendedTheme {
    val colors: ExtendedColors
        @Composable
        get() = LocalExtendedColors.current
}