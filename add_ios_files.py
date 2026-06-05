from pbxproj import XcodeProject

project = XcodeProject.load('ios/App/App.xcodeproj/project.pbxproj')

# Add swift files
project.add_file('App/NoteDatabase.swift', force=False)
project.add_file('App/KeyManager.swift', force=False)
project.add_file('App/NoteStoragePlugin.swift', force=False)

# Add SPM dependency
project.add_package(
    repository_url='https://github.com/stephencelis/SQLite.swift', 
    product_name='SQLiteCipher', 
    version_requirement={'kind': 'upToNextMajorVersion', 'minimumVersion': '0.15.3'}, 
    target_name='App'
)

project.save()
print("Successfully added files and package to project.pbxproj")
