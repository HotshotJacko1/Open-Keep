import Foundation
import WidgetKit

/// Reloads all widget timelines on the iOS home screen.
/// Call this after any note mutation so widgets reflect the latest data.
@objc class WidgetRefresher: NSObject {
    @objc static func refreshAllWidgets() {
        if #available(iOS 14.0, *) {
            WidgetCenter.shared.reloadAllTimelines()
        }
    }
}