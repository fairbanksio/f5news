package io.fairbanks.f5oclock.core.util

import java.text.ParseException
import java.text.SimpleDateFormat
import java.util.*
import java.util.concurrent.TimeUnit

class TimeAgo {
    fun covertTimeToText(dataDate: Long): String? {
        var convTime: String? = null

        val pasTime = Date(dataDate)
        val nowTime = Date()
        val dateDiff: Long = nowTime.getTime() - pasTime.getTime()
        val second: Long = TimeUnit.MILLISECONDS.toSeconds(dateDiff)
        val minute: Long = TimeUnit.MILLISECONDS.toMinutes(dateDiff)
        val hour: Long = TimeUnit.MILLISECONDS.toHours(dateDiff)
        val day: Long = TimeUnit.MILLISECONDS.toDays(dateDiff)
        if (second < 60) {
            convTime = second.toString() + "s"
        } else if (minute < 60) {
            convTime = minute.toString() + "m"
        } else if (hour < 24) {
            convTime = hour.toString() + "h"
        } else if (day >= 7) {
            convTime = if (day > 360) {
                (day / 360).toString() + "y"
            } else if (day > 30) {
                (day / 30).toString() + "mo"
            } else {
                (day / 7).toString() + "w"
            }
        } else if (day < 7) {
            convTime = day.toString() + "d"
        }

        return convTime
    }
}