package com.cityrail.simulator

import android.annotation.SuppressLint
import android.app.Activity
import android.content.pm.ActivityInfo
import android.os.Bundle
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import com.cityrail.simulator.payment.PaymentGatewayFactory
import java.io.ByteArrayInputStream

class MainActivity : Activity() {
    private lateinit var webView: WebView
    private lateinit var licenseStore: LicenseStore
    private lateinit var channel: String

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        channel = readChannel()
        licenseStore = LicenseStore(this)

        webView = WebView(this)
        setContentView(webView)

        WebView.setWebContentsDebuggingEnabled(false)
        webView.setBackgroundColor(getColor(R.color.cityrail_bg))
        webView.webChromeClient = WebChromeClient()
        webView.webViewClient = CityRailWebViewClient()
        webView.addJavascriptInterface(
            AndroidBridge(
                this,
                licenseStore,
                PaymentGatewayFactory.create(this, channel)
            ),
            "CityRailAndroid"
        )
        webView.addJavascriptInterface(AndroidAppInfo(), "CityRailAndroidInfo")

        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            cacheMode = WebSettings.LOAD_DEFAULT
            allowFileAccess = true
            allowContentAccess = true
            allowFileAccessFromFileURLs = true
            allowUniversalAccessFromFileURLs = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            userAgentString = "$userAgentString CityRailAndroid/$channel"
        }

        window.decorView.systemUiVisibility =
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION

        webView.loadUrl("file:///android_asset/www/index.html?cityrailApp=android&channel=$channel")
    }

    override fun onBackPressed() {
        if (::webView.isInitialized && webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    fun pushLicenseStateToWeb() {
        val json = licenseStore.stateJson(channel)
        webView.evaluateJavascript("window.CityRailAndroidApp&&window.CityRailAndroidApp.onLicenseState($json)", null)
    }

    fun pushPaymentMessage(message: String) {
        val safe = org.json.JSONObject.quote(message)
        webView.evaluateJavascript("window.CityRailAndroidApp&&window.CityRailAndroidApp.onPaymentMessage($safe)", null)
    }

    private fun readChannel(): String {
        val appInfo = packageManager.getApplicationInfo(packageName, android.content.pm.PackageManager.GET_META_DATA)
        return appInfo.metaData?.getString("cityrail.channel") ?: "generic"
    }

    private inner class CityRailWebViewClient : WebViewClient() {
        override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest?): WebResourceResponse? {
            val url = request?.url ?: return null
            val path = url.path ?: return null
            if (url.scheme == "file" && path.endsWith("/www/index.html")) {
                return injectedIndex()
            }
            return null
        }
    }

    private fun injectedIndex(): WebResourceResponse {
        val html = assets.open("www/index.html").bufferedReader(Charsets.UTF_8).use { it.readText() }
        val boot = """
            <script>
            window.CITYRAIL_ANDROID_APP={enabled:true,channel:"$channel",productName:"CityRail 轨道交通模拟器",localOnly:true};
            window.CITYRAIL_API_BASE=window.CITYRAIL_API_BASE||"https://cityrailgame.com";
            document.documentElement.classList.add("cityrail-android-app");
            </script>
            <script src="android-app-mode.js"></script>
        """.trimIndent()
        val injected = html.replace("<head>", "<head>\n$boot")
        return WebResourceResponse(
            "text/html",
            "utf-8",
            ByteArrayInputStream(injected.toByteArray(Charsets.UTF_8))
        )
    }

    inner class AndroidAppInfo {
        @JavascriptInterface
        fun getChannel(): String = channel
    }
}
