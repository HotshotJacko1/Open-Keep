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
} else if (process.argv.includes('--check')) {
  // --check: report drift without writing, so lint/CI can fail a commit whose
  // iOS version lags build.gradle (prebuild only fixes it at build time).
  const stale = [...pbxprojContent.matchAll(/MARKETING_VERSION\s*=\s*([^;]+);/g)]
    .map((m) => m[1].trim())
    .filter((v) => v !== versionName);
  if (stale.length > 0) {
    console.error(
      `iOS MARKETING_VERSION (${[...new Set(stale)].join(', ')}) does not match Android versionName ${versionName}. ` +
        'Run `node scripts/sync-version.cjs` and commit project.pbxproj.'
    );
    process.exit(1);
  }
  console.log(`iOS MARKETING_VERSION matches Android versionName ${versionName}`);
} else {
  pbxprojContent = pbxprojContent.replace(marketingVersionRegex, `MARKETING_VERSION = ${versionName};`);
  fs.writeFileSync(pbxprojPath, pbxprojContent, 'utf8');
  console.log(`Successfully synced iOS MARKETING_VERSION to ${versionName}`);
}
