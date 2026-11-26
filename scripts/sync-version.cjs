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

// 2. Desktop app (src-tauri): tauri.conf.json and Cargo.toml need semver.
// x.y.z is used as is; a fourth part (5.4.0.1) becomes build metadata (5.4.0+1),
// which the Windows installer turns back into its four-part file version.
const toDesktopVersion = (v) => {
  const parts = v.split('.');
  if (parts.length === 4 && parts.every((p) => /^\d+$/.test(p))) return `${parts.slice(0, 3).join('.')}+${parts[3]}`;
  if (/^\d+\.\d+\.\d+$/.test(v)) return v;
  console.error(`Can't turn versionName ${v} into a desktop (semver) version`);
  process.exit(1);
};
const desktopVersion = toDesktopVersion(versionName);
const tauriConfPath = path.join(rootDir, 'src-tauri', 'tauri.conf.json');
const cargoTomlPath = path.join(rootDir, 'src-tauri', 'Cargo.toml');
const checking = process.argv.includes('--check');
let desktopDrift = [];
if (fs.existsSync(tauriConfPath)) {
  const conf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf8'));
  if (conf.version !== desktopVersion) {
    if (checking) desktopDrift.push(`src-tauri/tauri.conf.json has ${conf.version}`);
    else {
      conf.version = desktopVersion;
      fs.writeFileSync(tauriConfPath, JSON.stringify(conf, null, 2) + '\n', 'utf8');
      console.log(`Synced src-tauri/tauri.conf.json to ${desktopVersion}`);
    }
  }
}
if (fs.existsSync(cargoTomlPath)) {
  const cargo = fs.readFileSync(cargoTomlPath, 'utf8');
  // The first version line is [package]'s; dependency versions come later.
  const current = cargo.match(/^version\s*=\s*"([^"]+)"/m);
  if (current && current[1] !== desktopVersion) {
    if (checking) desktopDrift.push(`src-tauri/Cargo.toml has ${current[1]}`);
    else {
      fs.writeFileSync(cargoTomlPath, cargo.replace(/^version\s*=\s*"[^"]+"/m, `version = "${desktopVersion}"`), 'utf8');
      console.log(`Synced src-tauri/Cargo.toml to ${desktopVersion}`);
    }
  }
}
// Cargo.lock records the app's own version too; CI's `cargo test --locked`
// fails if it lags behind Cargo.toml.
const cargoLockPath = path.join(rootDir, 'src-tauri', 'Cargo.lock');
if (fs.existsSync(cargoLockPath)) {
  const lock = fs.readFileSync(cargoLockPath, 'utf8');
  const entry = /(\[\[package\]\]\r?\nname = "open-keep"\r?\nversion = ")([^"]+)(")/;
  const current = lock.match(entry);
  if (current && current[2] !== desktopVersion) {
    if (checking) desktopDrift.push(`src-tauri/Cargo.lock has ${current[2]}`);
    else {
      fs.writeFileSync(cargoLockPath, lock.replace(entry, `$1${desktopVersion}$3`), 'utf8');
      console.log(`Synced src-tauri/Cargo.lock to ${desktopVersion}`);
    }
  }
}
if (desktopDrift.length > 0) {
  console.error(
    `Desktop version should be ${desktopVersion} (from Android versionName ${versionName}): ${desktopDrift.join('; ')}. ` +
      'Run `node scripts/sync-version.cjs` and commit the src-tauri files.'
  );
  process.exit(1);
}

// 3. Update MARKETING_VERSION in project.pbxproj
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
