package io.fairbanks.f5oclock.core.util

import java.text.ParseException
import java.text.SimpleDateFormat
import java.util.*
import java.util.concurrent.TimeUnit

class TimeAgo {
    fun covertTimeToText(dataDate: Long): String? {
        var convTime: String? = null
        val suffix = "Ago"

        val pasTime = Date(dataDate)
        val nowTime = Date()
        val dateDiff: Long = nowTime.getTime() - pasTime.getTime()
        val second: Long = TimeUnit.MILLISECONDS.toSeconds(dateDiff)
        val minute: Long = TimeUnit.MILLISECONDS.toMinutes(dateDiff)
        val hour: Long = TimeUnit.MILLISECONDS.toHours(dateDiff)
        val day: Long = TimeUnit.MILLISECONDS.toDays(dateDiff)
        if (second < 60) {
            convTime = "$second Seconds $suffix"
        } else if (minute < 60) {
            convTime = "$minute Minutes $suffix"
        } else if (hour < 24) {
            convTime = "$hour Hours $suffix"
        } else if (day >= 7) {
            convTime = if (day > 360) {
                (day / 360).toString() + " Years " + suffix
            } else if (day > 30) {
                (day / 30).toString() + " Months " + suffix
            } else {
                (day / 7).toString() + " Week " + suffix
            }
        } else if (day < 7) {
            convTime = "$day Days $suffix"
        }

        return convTime
    }
}