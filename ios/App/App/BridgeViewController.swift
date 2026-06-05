import Capacitor
import CapApp_SPM

class BridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(NoteStoragePlugin())
        if let bridge {
            registerCapgoPlugins(with: bridge)
        }
    }
}
