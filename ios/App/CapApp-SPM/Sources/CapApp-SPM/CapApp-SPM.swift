import Capacitor
import SocialLoginPlugin

public let isCapacitorApp = true

public func registerCapgoPlugins(with bridge: CAPBridgeProtocol) {
    bridge.registerPluginInstance(SocialLoginPlugin())
}
