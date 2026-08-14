from pbxproj import XcodeProject

project = XcodeProject.load('ios/App/App.xcodeproj/project.pbxproj')

project.add_file('App/SharedAppGroup.swift', force=False)
project.add_file('App/WidgetRefresher.swift', force=False)

project.save()
print("Successfully added files to project.pbxproj")
