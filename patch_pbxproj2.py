import re
import uuid

def gen_id(): return uuid.uuid4().hex[:24].upper()

m_ref = gen_id()
m_bld = gen_id()

with open('ios/App/App.xcodeproj/project.pbxproj', 'r') as f:
    pbx = f.read()

# 1. PBXBuildFile
build_file_str = f"""
		{m_bld} /* NoteStoragePlugin.m in Sources */ = {{isa = PBXBuildFile; fileRef = {m_ref} /* NoteStoragePlugin.m */; }};
"""
pbx = pbx.replace('/* End PBXBuildFile section */', build_file_str + '/* End PBXBuildFile section */')

# 2. PBXFileReference
file_ref_str = f"""
		{m_ref} /* NoteStoragePlugin.m */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.c.objc; path = NoteStoragePlugin.m; sourceTree = "<group>"; }};
"""
pbx = pbx.replace('/* End PBXFileReference section */', file_ref_str + '/* End PBXFileReference section */')

# 3. PBXGroup
app_grp_str = f"""
				{m_ref} /* NoteStoragePlugin.m */,
"""
pbx = re.sub(r'(504EC3061FED79650016851F \/\* App \*\/ = \{\s*isa = PBXGroup;\s*children = \()', r'\1' + app_grp_str, pbx)

# 4. PBXSourcesBuildPhase
src_bld_str = f"""
				{m_bld} /* NoteStoragePlugin.m in Sources */,
"""
pbx = re.sub(r'(isa = PBXSourcesBuildPhase;\s*buildActionMask = 2147483647;\s*files = \()', r'\1' + src_bld_str, pbx)

with open('ios/App/App.xcodeproj/project.pbxproj', 'w') as f:
    f.write(pbx)

print("Modified pbxproj for NoteStoragePlugin.m successfully.")
