package com.example.hospital_system

import android.content.ContentValues
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.File

class MainActivity : FlutterActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        // Lets the Flutter side save PDFs and backups to the phone's public Downloads folder.
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "his/save")
            .setMethodCallHandler { call, result ->
                if (call.method == "saveToDownloads") {
                    val name = call.argument<String>("name") ?: "file"
                    val bytes = call.argument<ByteArray>("bytes")
                    val mime = call.argument<String>("mime") ?: "application/octet-stream"
                    if (bytes == null) {
                        result.error("NO_DATA", "No file data", null)
                    } else {
                        try {
                            result.success(saveToDownloads(name, bytes, mime))
                        } catch (e: Exception) {
                            result.error("SAVE_FAILED", e.message, null)
                        }
                    }
                } else {
                    result.notImplemented()
                }
            }
    }

    private fun saveToDownloads(name: String, bytes: ByteArray, mime: String): String {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            // Android 10+: add the file to the Downloads collection (no storage permission needed)
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, name)
                put(MediaStore.Downloads.MIME_TYPE, mime)
                put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
            }
            val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                ?: throw Exception("Could not create the file in Downloads")
            contentResolver.openOutputStream(uri)?.use { it.write(bytes) }
                ?: throw Exception("Could not write the file")
            return "Downloads/$name"
        } else {
            // Android 9 and older: write directly (needs the storage permission in the manifest)
            val dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
            dir.mkdirs()
            val file = File(dir, name)
            file.writeBytes(bytes)
            return file.absolutePath
        }
    }
}
