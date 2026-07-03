import WidgetKit
import SwiftUI

@main
struct NewNoteWidgetBundle: WidgetBundle {
    var body: some Widget {
        NewNoteWidget()
        NoteCollectionWidgetIOS()
    }
}
