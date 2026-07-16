package com.cityrail.simulator.payment

interface PaymentGateway {
    val channel: String
    fun requestProfessionalLicense(callback: (PaymentResult) -> Unit)
}

sealed class PaymentResult {
    data class Success(val orderId: String) : PaymentResult()
    data class Unavailable(val message: String) : PaymentResult()
    data class Failure(val message: String) : PaymentResult()
}
