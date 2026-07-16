package com.cityrail.simulator

import android.webkit.JavascriptInterface
import com.cityrail.simulator.payment.PaymentGateway
import com.cityrail.simulator.payment.PaymentResult
import org.json.JSONObject

class AndroidBridge(
    private val activity: MainActivity,
    private val licenseStore: LicenseStore,
    private val paymentGateway: PaymentGateway
) {
    @JavascriptInterface
    fun getLicenseState(): String = licenseStore.stateJson(paymentGateway.channel)

    @JavascriptInterface
    fun requestProfessionalLicense(): String {
        activity.runOnUiThread {
            paymentGateway.requestProfessionalLicense { result ->
                when (result) {
                    is PaymentResult.Success -> {
                        licenseStore.markProfessional(result.orderId, paymentGateway.channel)
                        activity.pushLicenseStateToWeb()
                    }
                    is PaymentResult.Unavailable -> activity.pushPaymentMessage(result.message)
                    is PaymentResult.Failure -> activity.pushPaymentMessage(result.message)
                }
            }
        }
        return JSONObject()
            .put("accepted", true)
            .put("channel", paymentGateway.channel)
            .toString()
    }
}
