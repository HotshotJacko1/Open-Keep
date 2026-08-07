import Capacitor
import CapApp_SPM

class BridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(NoteStoragePlugin())
        if let bridge {
            registerCapgoPlugins(with: bridge)
        }

        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleWidgetDeepLinkNotification(_:)),
            name: WidgetDeepLinkReplay.notification,
            object: nil
        )
        replayPendingWidgetDeepLink()
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    @objc private func handleWidgetDeepLinkNotification(_ notification: Notification) {
        guard let urlString = notification.object as? String else { return }
        replayWidgetDeepLink(urlString)
    }

    private func replayPendingWidgetDeepLink() {
        guard let urlString = UserDefaults.standard.string(forKey: WidgetDeepLinkReplay.pendingURLKey) else {
            return
        }
        replayWidgetDeepLink(urlString)
    }

    private func replayWidgetDeepLink(_ urlString: String) {
        guard let encodedURL = javascriptStringLiteral(urlString) else { return }

        let script = """
        window.localStorage.setItem('\(WidgetDeepLinkReplay.pendingURLKey)', \(encodedURL));
        window.dispatchEvent(new CustomEvent('openkeep-widget-url', { detail: { url: \(encodedURL) } }));
        """

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
            self?.webView?.evaluateJavaScript(script) { _, error in
                if error == nil {
                    UserDefaults.standard.removeObject(forKey: WidgetDeepLinkReplay.pendingURLKey)
                }
            }
        }
    }

    private func javascriptStringLiteral(_ value: String) -> String? {
        guard let data = try? JSONSerialization.data(withJSONObject: [value]),
              let json = String(data: data, encoding: .utf8),
              json.count >= 2 else {
            return nil
        }
        return String(json.dropFirst().dropLast())
    }
}
