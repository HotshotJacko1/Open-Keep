import re

with open('ios/App/App.xcodeproj/project.pbxproj', 'r', encoding='utf-8') as f:
    pbx = f.read()

# Set SWIFT_OBJC_BRIDGING_HEADER for all buildSettings blocks in the App target
# Xcode stores this as: SWIFT_OBJC_BRIDGING_HEADER = "App/App-Bridging-Header.h";
bridging_header_value = 'SWIFT_OBJC_BRIDGING_HEADER = "App/App-Bridging-Header.h";'

# Only add if not already present
if 'SWIFT_OBJC_BRIDGING_HEADER' not in pbx:
    # Add before SWIFT_VERSION (which always exists in the App target build settings)
    pbx = re.sub(
        r'(SWIFT_VERSION = 5\.0;)',
        bridging_header_value + '\n\t\t\t\t' + r'\1',
        pbx
    )
    print("Added SWIFT_OBJC_BRIDGING_HEADER")
else:
    print("SWIFT_OBJC_BRIDGING_HEADER already present")

with open('ios/App/App.xcodeproj/project.pbxproj', 'w', encoding='utf-8') as f:
    f.write(pbx)

print("Done.")
