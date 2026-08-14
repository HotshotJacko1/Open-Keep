import re
import uuid

def gen_id(): return uuid.uuid4().hex[:24].upper()

sag_ref = gen_id()
sag_bld = gen_id()
wr_ref = gen_id()
wr_bld = gen_id()

with open('ios/App/App.xcodeproj/project.pbxproj', 'r') as f:
    pbx = f.read()

# 1. PBXBuildFile
build_file_str = f"""
		{sag_bld} /* SharedAppGroup.swift in Sources */ = {{isa = PBXBuildFile; fileRef = {sag_ref} /* SharedAppGroup.swift */; }};
		{wr_bld} /* WidgetRefresher.swift in Sources */ = {{isa = PBXBuildFile; fileRef = {wr_ref} /* WidgetRefresher.swift */; }};
"""
pbx = pbx.replace('/* End PBXBuildFile section */', build_file_str + '/* End PBXBuildFile section */')

# 2. PBXFileReference
file_ref_str = f"""
		{sag_ref} /* SharedAppGroup.swift */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = SharedAppGroup.swift; sourceTree = "<group>"; }};
		{wr_ref} /* WidgetRefresher.swift */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = WidgetRefresher.swift; sourceTree = "<group>"; }};
"""
pbx = pbx.replace('/* End PBXFileReference section */', file_ref_str + '/* End PBXFileReference section */')

# 3. PBXGroup
app_grp_str = f"""
				{sag_ref} /* SharedAppGroup.swift */,
				{wr_ref} /* WidgetRefresher.swift */,
"""
pbx = re.sub(r'(504EC3061FED79650016851F \/\* App \*\/ = \{\s*isa = PBXGroup;\s*children = \()', r'\1' + app_grp_str, pbx)

# 4. PBXSourcesBuildPhase
src_bld_str = f"""
				{sag_bld} /* SharedAppGroup.swift in Sources */,
				{wr_bld} /* WidgetRefresher.swift in Sources */,
"""
pbx = re.sub(r'(isa = PBXSourcesBuildPhase;\s*buildActionMask = 2147483647;\s*files = \()', r'\1' + src_bld_str, pbx)

with open('ios/App/App.xcodeproj/project.pbxproj', 'w') as f:
    f.write(pbx)

print("Modified pbxproj for missing swift files successfully.")
