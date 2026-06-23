const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const gradlePath = path.join(rootDir, 'android', 'app', 'build.gradle');
const pbxprojPath = path.join(rootDir, 'ios', 'App', 'App.xcodeproj', 'project.pbxproj');

// 1. Read the versionName from build.gradle
if (!fs.existsSync(gradlePath)) {
  console.error(`Could not find build.gradle at ${gradlePath}`);
  process.exit(1);
}

const gradleContent = fs.readFileSync(gradlePath, 'utf8');
const versionMatch = gradleContent.match(/versionName\s+"([^"]+)"/);

if (!versionMatch || !versionMatch[1]) {
  console.error('Could not parse versionName from build.gradle');
  process.exit(1);
}

const versionName = versionMatch[1];
console.log(`Found Android versionName: ${versionName}`);

// 2. Update MARKETING_VERSION in project.pbxproj
if (!fs.existsSync(pbxprojPath)) {
  console.error(`Could not find project.pbxproj at ${pbxprojPath}`);
  process.exit(1);
}

let pbxprojContent = fs.readFileSync(pbxprojPath, 'utf8');
const marketingVersionRegex = /MARKETING_VERSION\s*=\s*[^;]+;/g;

if (!marketingVersionRegex.test(pbxprojContent)) {
  console.warn('MARKETING_VERSION not found in project.pbxproj.');
} else {
  pbxprojContent = pbxprojContent.replace(marketingVersionRegex, `MARKETING_VERSION = ${versionName};`);
  fs.writeFileSync(pbxprojPath, pbxprojContent, 'utf8');
  console.log(`Successfully synced iOS MARKETING_VERSION to ${versionName}`);
}
