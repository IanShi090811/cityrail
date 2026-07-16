package com.cityrail.simulator

import android.content.Context
import org.json.JSONObject

class LicenseStore(context: Context) {
    private val prefs = context.getSharedPreferences("cityrail_license", Context.MODE_PRIVATE)
    private val trialMillis = 30L * 60L * 1000L

    init {
        if (!prefs.contains("trial_started_at")) {
            prefs.edit().putLong("trial_started_at", System.currentTimeMillis()).apply()
        }
    }

    fun markProfessional(orderId: String, channel: String) {
        prefs.edit()
            .putBoolean("professional", true)
            .putString("order_id", orderId)
            .putString("channel", channel)
            .putLong("licensed_at", System.currentTimeMillis())
            .apply()
    }

    fun stateJson(channel: String): String {
        val now = System.currentTimeMillis()
        val startedAt = prefs.getLong("trial_started_at", now)
        val expiresAt = startedAt + trialMillis
        val professional = prefs.getBoolean("professional", false)
        return JSONObject()
            .put("productName", "CityRail 轨道交通模拟器")
            .put("channel", channel)
            .put("professional", professional)
            .put("trialStartedAt", startedAt)
            .put("trialExpiresAt", expiresAt)
            .put("trialRemainingMs", if (professional) Long.MAX_VALUE else maxOf(0L, expiresAt - now))
            .put("orderId", prefs.getString("order_id", ""))
            .toString()
    }
}
