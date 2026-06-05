import sys
import re

with open('ios/App/App.xcodeproj/project.pbxproj', 'r') as f:
    pbx = f.read()

# Add GCC_PREPROCESSOR_DEFINITIONS
if 'GCC_PREPROCESSOR_DEFINITIONS' in pbx:
    pbx = re.sub(r'(GCC_PREPROCESSOR_DEFINITIONS = \()', r'\1\n\t\t\t\t\t"SQLITE_HAS_CODEC=1",', pbx)
else:
    pbx = re.sub(r'(buildSettings = \{)', r'\1\n\t\t\t\tGCC_PREPROCESSOR_DEFINITIONS = (\n\t\t\t\t\t"SQLITE_HAS_CODEC=1",\n\t\t\t\t\t"$(inherited)",\n\t\t\t\t);', pbx)

# Add OTHER_SWIFT_FLAGS
if 'OTHER_SWIFT_FLAGS' in pbx:
    pbx = re.sub(r'(OTHER_SWIFT_FLAGS = \()', r'\1\n\t\t\t\t\t"-Xcc",\n\t\t\t\t\t"-DSQLITE_HAS_CODEC=1",', pbx)
else:
    pbx = re.sub(r'(buildSettings = \{)', r'\1\n\t\t\t\tOTHER_SWIFT_FLAGS = (\n\t\t\t\t\t"-Xcc",\n\t\t\t\t\t"-DSQLITE_HAS_CODEC=1",\n\t\t\t\t\t"$(inherited)",\n\t\t\t\t);', pbx)

with open('ios/App/App.xcodeproj/project.pbxproj', 'w') as f:
    f.write(pbx)

print("Updated project.pbxproj with SQLITE_HAS_CODEC")
