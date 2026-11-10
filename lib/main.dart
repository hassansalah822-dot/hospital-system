import 'dart:convert';
import 'dart:io';

import 'package:file_selector/file_selector.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';

void main() => runApp(
    const MaterialApp(debugShowCheckedModeBanner: false, home: HisPage()));

class HisPage extends StatefulWidget {
  const HisPage({super.key});
  @override
  State<HisPage> createState() => _HisPageState();
}

class _HisPageState extends State<HisPage> {
  late final WebViewController _controller;

  @override
  void initState() {
    super.initState();
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      // Web code sends generated PDFs / backups here to be saved and shared.
      ..addJavaScriptChannel('HisSave', onMessageReceived: (message) {
        _saveFromWeb(message.message);
      })
      ..loadFlutterAsset('assets/web/index.html');

    // Lets the <input type="file"> buttons (Choose picture / Take photo /
    // Import backup) open the phone's picker or camera.
    final platform = _controller.platform;
    if (platform is AndroidWebViewController) {
      platform.setOnShowFileSelector(_onShowFileSelector);
    }
  }

  /// Called by the WebView when a file input is tapped.
  Future<List<String>> _onShowFileSelector(FileSelectorParams params) async {
    final wantsImage = params.acceptTypes.isEmpty ||
        params.acceptTypes.any((t) => t.startsWith('image'));

    if (wantsImage) {
      final picker = ImagePicker();
      final XFile? picked = await picker.pickImage(
        source: params.isCaptureEnabled
            ? ImageSource.camera
            : ImageSource.gallery,
        imageQuality: 85,
        maxWidth: 2000,
      );
      if (picked == null) return <String>[];
      return [Uri.file(picked.path).toString()];
    }

    // Non-image files, e.g. the JSON backup file.
    final XFile? file = await openFile(
      acceptedTypeGroups: [
        const XTypeGroup(
          label: 'JSON',
          extensions: ['json'],
          mimeTypes: ['application/json'],
        ),
      ],
    );
    if (file == null) return <String>[];
    return [Uri.file(file.path).toString()];
  }

  /// Saves a file sent from the web code, then opens the share sheet so the
  /// user can keep it (Files, Drive, WhatsApp, email, etc.).
  Future<void> _saveFromWeb(String raw) async {
    try {
      final data = jsonDecode(raw) as Map<String, dynamic>;
      final name = data['name'] as String;
      final dataUrl = data['dataUrl'] as String;
      final bytes = base64Decode(dataUrl.substring(dataUrl.indexOf(',') + 1));

      final dir = await getApplicationDocumentsDirectory();
      final file = File('${dir.path}/$name');
      await file.writeAsBytes(bytes, flush: true);

      await Share.shareXFiles([XFile(file.path)], subject: name);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not save the file: $e')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, result) async {
        if (didPop) return;
        if (await _controller.canGoBack()) {
          await _controller.goBack();
          return;
        }
        if (!context.mounted) return;
        final leave = await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            title: const Text('Close Merowe HIS?'),
            content: const Text(
                'Any unsaved entries on the open form will be lost.'),
            actions: [
              TextButton(
                  onPressed: () => Navigator.pop(ctx, false),
                  child: const Text('Stay')),
              TextButton(
                  onPressed: () => Navigator.pop(ctx, true),
                  child: const Text('Close')),
            ],
          ),
        );
        if (leave == true) SystemNavigator.pop();
      },
      child: Scaffold(
          body: SafeArea(child: WebViewWidget(controller: _controller))),
    );
  }
}
