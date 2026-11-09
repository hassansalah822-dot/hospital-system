import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:webview_flutter/webview_flutter.dart';

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
      ..loadFlutterAsset('assets/web/index.html');
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
