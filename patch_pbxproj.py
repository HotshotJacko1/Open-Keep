import re
import uuid

def gen_id(): return uuid.uuid4().hex[:24].upper()

nd_ref = gen_id()
nd_bld = gen_id()
km_ref = gen_id()
km_bld = gen_id()
nsp_ref = gen_id()
nsp_bld = gen_id()

pkg_ref = gen_id()
pkg_dep = gen_id()
pkg_bld = gen_id()

with open('ios/App/App.xcodeproj/project.pbxproj', 'r') as f:
    pbx = f.read()

# 1. PBXBuildFile
build_file_str = f"""
		{nd_bld} /* NoteDatabase.swift in Sources */ = {{isa = PBXBuildFile; fileRef = {nd_ref} /* NoteDatabase.swift */; }};
		{km_bld} /* KeyManager.swift in Sources */ = {{isa = PBXBuildFile; fileRef = {km_ref} /* KeyManager.swift */; }};
		{nsp_bld} /* NoteStoragePlugin.swift in Sources */ = {{isa = PBXBuildFile; fileRef = {nsp_ref} /* NoteStoragePlugin.swift */; }};
		{pkg_bld} /* SQLiteCipher in Frameworks */ = {{isa = PBXBuildFile; productRef = {pkg_dep} /* SQLiteCipher */; }};
"""
pbx = pbx.replace('/* End PBXBuildFile section */', build_file_str + '/* End PBXBuildFile section */')

# 2. PBXFileReference
file_ref_str = f"""
		{nd_ref} /* NoteDatabase.swift */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = NoteDatabase.swift; sourceTree = "<group>"; }};
		{km_ref} /* KeyManager.swift */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = KeyManager.swift; sourceTree = "<group>"; }};
		{nsp_ref} /* NoteStoragePlugin.swift */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = NoteStoragePlugin.swift; sourceTree = "<group>"; }};
"""
pbx = pbx.replace('/* End PBXFileReference section */', file_ref_str + '/* End PBXFileReference section */')

# 3. PBXFrameworksBuildPhase
fw_bld_str = f"""
				{pkg_bld} /* SQLiteCipher in Frameworks */,
"""
pbx = re.sub(r'(isa = PBXFrameworksBuildPhase;\s*buildActionMask = 2147483647;\s*files = \()', r'\1' + fw_bld_str, pbx)

# 4. PBXGroup (App group has id 504EC3061FED79650016851F)
app_grp_str = f"""
				{nd_ref} /* NoteDatabase.swift */,
				{km_ref} /* KeyManager.swift */,
				{nsp_ref} /* NoteStoragePlugin.swift */,
"""
pbx = re.sub(r'(504EC3061FED79650016851F \/\* App \*\/ = \{\s*isa = PBXGroup;\s*children = \()', r'\1' + app_grp_str, pbx)

# 5. PBXNativeTarget dependencies
pkg_tgt_dep = f"""
				{pkg_dep} /* SQLiteCipher */,
"""
pbx = re.sub(r'(packageProductDependencies = \()', r'\1' + pkg_tgt_dep, pbx)

# 6. PBXProject packageReferences
pkg_proj_ref = f"""
				{pkg_ref} /* XCRemoteSwiftPackageReference "SQLite.swift" */,
"""
pbx = re.sub(r'(packageReferences = \()', r'\1' + pkg_proj_ref, pbx)

# 7. PBXSourcesBuildPhase
src_bld_str = f"""
				{nd_bld} /* NoteDatabase.swift in Sources */,
				{km_bld} /* KeyManager.swift in Sources */,
				{nsp_bld} /* NoteStoragePlugin.swift in Sources */,
"""
pbx = re.sub(r'(isa = PBXSourcesBuildPhase;\s*buildActionMask = 2147483647;\s*files = \()', r'\1' + src_bld_str, pbx)

# 8. XCRemoteSwiftPackageReference
remote_pkg_str = f"""
/* Begin XCRemoteSwiftPackageReference section */
		{pkg_ref} /* XCRemoteSwiftPackageReference "SQLite.swift" */ = {{
			isa = XCRemoteSwiftPackageReference;
			repositoryURL = "https://github.com/stephencelis/SQLite.swift.git";
			requirement = {{
				kind = upToNextMajorVersion;
				minimumVersion = 0.15.3;
			}};
		}};
/* End XCRemoteSwiftPackageReference section */
"""
pbx = pbx.replace('/* Begin XCSwiftPackageProductDependency section */', remote_pkg_str + '\n/* Begin XCSwiftPackageProductDependency section */')

# 9. XCSwiftPackageProductDependency
pkg_prod_dep_str = f"""
		{pkg_dep} /* SQLiteCipher */ = {{
			isa = XCSwiftPackageProductDependency;
			package = {pkg_ref} /* XCRemoteSwiftPackageReference "SQLite.swift" */;
			productName = SQLiteCipher;
		}};
"""
pbx = pbx.replace('/* End XCSwiftPackageProductDependency section */', pkg_prod_dep_str + '/* End XCSwiftPackageProductDependency section */')

with open('ios/App/App.xcodeproj/project.pbxproj', 'w') as f:
    f.write(pbx)

print("Modified pbxproj successfully.")
