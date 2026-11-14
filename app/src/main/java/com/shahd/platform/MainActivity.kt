package com.shahd.platform

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.ContentValues
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.print.PrintAttributes
import android.print.PrintManager
import android.provider.MediaStore
import android.util.Base64
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.JsPromptResult
import android.webkit.JsResult
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.WebViewAssetLoader

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var assetLoader: WebViewAssetLoader
    private lateinit var shimJs: String

    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingBytes: ByteArray? = null
    private val printViews = mutableListOf<WebView>()

    companion object {
        // نطاق https وهمي تخدمه الأصول المحلية؛ يمنح المنصة سياقاً آمناً
        // (مطلوب لـ crypto.subtle في license.js) ويُبقي localStorage ثابتاً.
        const val HOST = "appassets.androidplatform.net"
        const val BASE = "https://$HOST/assets/www/"
        const val START = BASE + "index.html"
        const val REQ_FILE = 1001
        const val REQ_SAVE = 1002
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        shimJs = assets.open("shim.js").bufferedReader(Charsets.UTF_8).use { it.readText() }
        assetLoader = WebViewAssetLoader.Builder()
            .setDomain(HOST)
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        if ((applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true)
        }

        webView = WebView(this)
        setContentView(webView)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            textZoom = 100
            useWideViewPort = true
            setSupportZoom(true)
            builtInZoomControls = true
            displayZoomControls = false
        }

        // لا يُحمَّل أي محتوى خارجي داخل التطبيق (الروابط الخارجية تُفتح في المتصفح)،
        // لذا تبقى واجهة الجسر متاحة لصفحات المنصة فقط.
        webView.addJavascriptInterface(Bridge(), "AndroidBridge")

        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ): WebResourceResponse? = assetLoader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val u = request.url
                if (u.host == HOST) return false
                if (u.scheme == "blob" || u.scheme == "data" || u.scheme == "about") return false
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, u))
                } catch (_: ActivityNotFoundException) {
                }
                return true
            }

            override fun onPageFinished(view: WebView, url: String?) {
                view.evaluateJavascript(shimJs, null)
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                wv: WebView,
                callback: ValueCallback<Array<Uri>>,
                params: FileChooserParams
            ): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = "*/*"
                    if (params.mode == FileChooserParams.MODE_OPEN_MULTIPLE) {
                        putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                    }
                }
                return try {
                    startActivityForResult(intent, REQ_FILE)
                    true
                } catch (e: Exception) {
                    fileCallback = null
                    callback.onReceiveValue(null)
                    false
                }
            }

            override fun onJsAlert(view: WebView, url: String?, message: String?, result: JsResult): Boolean {
                showDialog(message, null, result, false)
                return true
            }

            override fun onJsConfirm(view: WebView, url: String?, message: String?, result: JsResult): Boolean {
                showDialog(message, null, result, true)
                return true
            }

            override fun onJsPrompt(
                view: WebView, url: String?, message: String?,
                defaultValue: String?, result: JsPromptResult
            ): Boolean {
                val input = EditText(this@MainActivity).apply { setText(defaultValue ?: "") }
                showDialog(message, input, result, true)
                return true
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) {
                    webView.goBack()
                } else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })

        if (savedInstanceState != null) webView.restoreState(savedInstanceState)
        else webView.loadUrl(START)
    }

    /** يعرض مربع حوار لـ alert / confirm / prompt. */
    private fun showDialog(message: String?, input: EditText?, result: JsResult, showCancel: Boolean) {
        val builder = AlertDialog.Builder(this).setMessage(message ?: "")
        if (input != null) builder.setView(input)
        builder.setPositiveButton("موافق") { _, _ ->
            if (input != null && result is JsPromptResult) result.confirm(input.text.toString())
            else result.confirm()
        }
        if (showCancel) builder.setNegativeButton("إلغاء") { _, _ -> result.cancel() }
        builder.setOnCancelListener { result.cancel() }
        val d = builder.create()
        d.show()
        d.window?.decorView?.layoutDirection = View.LAYOUT_DIRECTION_RTL
    }

    /* ---------------- حفظ الملفات ---------------- */

    private fun saveBytes(name: String, mime: String, bytes: ByteArray) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            try {
                val values = ContentValues().apply {
                    put(MediaStore.Downloads.DISPLAY_NAME, name)
                    put(MediaStore.Downloads.MIME_TYPE, mime)
                    put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
                }
                val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                    ?: throw IllegalStateException("insert failed")
                contentResolver.openOutputStream(uri)?.use { it.write(bytes) }
                    ?: throw IllegalStateException("stream failed")
                toast("تم حفظ الملف في مجلد التنزيلات: $name")
            } catch (e: Exception) {
                toast("تعذّر حفظ الملف")
            }
        } else {
            // أندرويد 9 وما دونه: نترك للمستخدم اختيار مكان الحفظ (بلا حاجة لصلاحيات)
            pendingBytes = bytes
            val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = mime
                putExtra(Intent.EXTRA_TITLE, name)
            }
            try {
                startActivityForResult(intent, REQ_SAVE)
            } catch (e: Exception) {
                pendingBytes = null
                toast("تعذّر حفظ الملف")
            }
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        when (requestCode) {
            REQ_FILE -> {
                fileCallback?.onReceiveValue(
                    WebChromeClient.FileChooserParams.parseResult(resultCode, data)
                )
                fileCallback = null
            }
            REQ_SAVE -> {
                val bytes = pendingBytes
                pendingBytes = null
                val uri = data?.data
                if (resultCode == RESULT_OK && uri != null && bytes != null) {
                    try {
                        contentResolver.openOutputStream(uri)?.use { it.write(bytes) }
                        toast("تم حفظ الملف")
                    } catch (e: Exception) {
                        toast("تعذّر حفظ الملف")
                    }
                }
            }
        }
    }

    /* ---------------- الطباعة ---------------- */

    private fun startPrint(wv: WebView, title: String) {
        val name = title.ifBlank { "منصة شهد" }
        val pm = getSystemService(PRINT_SERVICE) as PrintManager
        pm.print(name, wv.createPrintDocumentAdapter(name), PrintAttributes.Builder().build())
    }

    /** يطبع لقطة HTML (محتوى iframe) عبر WebView مخفي. */
    private fun printHtmlSnapshot(html: String, title: String) {
        val wv = WebView(this)
        wv.settings.javaScriptEnabled = false
        var printed = false
        wv.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ): WebResourceResponse? = assetLoader.shouldInterceptRequest(request.url)

            override fun onPageFinished(view: WebView, url: String?) {
                if (printed) return
                printed = true
                startPrint(view, title)
            }
        }
        printViews.add(wv)
        if (printViews.size > 3) printViews.removeAt(0).destroy()
        wv.loadDataWithBaseURL(BASE, html, "text/html", "UTF-8", null)
    }

    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_LONG).show()

    private fun safeName(n: String): String {
        val s = n.replace(Regex("[\\\\/:*?\"<>|]"), "_").trim()
        return if (s.isEmpty()) "shahd_file" else s
    }

    /** الجسر الذي تستدعيه shim.js من صفحات المنصة. */
    inner class Bridge {
        @JavascriptInterface
        fun saveBase64(name: String, mime: String, b64: String) {
            val bytes = try {
                Base64.decode(b64, Base64.DEFAULT)
            } catch (e: Exception) {
                runOnUiThread { toast("تعذّر حفظ الملف") }
                return
            }
            runOnUiThread {
                saveBytes(safeName(name), mime.ifBlank { "application/octet-stream" }, bytes)
            }
        }

        @JavascriptInterface
        fun printPage(title: String) {
            runOnUiThread { startPrint(webView, title) }
        }

        @JavascriptInterface
        fun printHtml(html: String, title: String) {
            runOnUiThread { printHtmlSnapshot(html, title) }
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onDestroy() {
        printViews.forEach { it.destroy() }
        printViews.clear()
        (webView.parent as? android.view.ViewGroup)?.removeView(webView)
        webView.destroy()
        super.onDestroy()
    }
}
