import re
import uuid

with open('ios/App/App.xcodeproj/project.pbxproj', 'r') as f:
    pbx = f.read()

# The UUIDs used previously:
# pkg_ref = XCRemoteSwiftPackageReference "SQLite.swift"
# pkg_dep = XCSwiftPackageProductDependency "SQLiteCipher"
# pkg_bld = PBXBuildFile "SQLiteCipher in Frameworks"

# Instead of searching by UUIDs, I will replace the strings.
pbx = pbx.replace('repositoryURL = "https://github.com/stephencelis/SQLite.swift.git";', 'repositoryURL = "https://github.com/sqlcipher/SQLCipher.swift.git";')
pbx = pbx.replace('minimumVersion = 0.15.3;', 'minimumVersion = 4.16.0;')
pbx = pbx.replace('productName = SQLiteCipher;', 'productName = SQLCipher;')
pbx = pbx.replace('/* XCRemoteSwiftPackageReference "SQLite.swift" */', '/* XCRemoteSwiftPackageReference "SQLCipher" */')
pbx = pbx.replace('/* SQLiteCipher */', '/* SQLCipher */')
pbx = pbx.replace('/* SQLiteCipher in Frameworks */', '/* SQLCipher in Frameworks */')

with open('ios/App/App.xcodeproj/project.pbxproj', 'w') as f:
    f.write(pbx)

print("Updated project.pbxproj to use SQLCipher.swift")
