package com.cityrail.simulator.payment

import android.app.Activity
import android.widget.Toast
import com.cityrail.simulator.R

object PaymentGatewayFactory {
    fun create(activity: Activity, channel: String): PaymentGateway {
        return when (channel.lowercase()) {
            "huawei" -> StorePaymentStub(activity, "huawei")
            "oppo" -> StorePaymentStub(activity, "oppo")
            "vivo" -> StorePaymentStub(activity, "vivo")
            else -> StorePaymentStub(activity, "generic")
        }
    }
}

private class StorePaymentStub(
    private val activity: Activity,
    override val channel: String
) : PaymentGateway {
    override fun requestProfessionalLicense(callback: (PaymentResult) -> Unit) {
        val message = activity.getString(R.string.payment_not_ready)
        Toast.makeText(activity, message, Toast.LENGTH_LONG).show()
        callback(PaymentResult.Unavailable(message))
    }
}
