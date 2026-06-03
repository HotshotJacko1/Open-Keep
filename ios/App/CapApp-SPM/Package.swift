// swift-tools-version: 5.9
import PackageDescription

// DO NOT MODIFY THIS FILE - managed by Capacitor CLI commands
let package = Package(
    name: "CapApp-SPM",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "CapApp-SPM",
            targets: ["CapApp-SPM"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.0.0"),
        .package(name: "CapacitorApp", path: "..\..\..\node_modules\.pnpm\@capacitor+app@8.0.0_@capacitor+core@8.0.0\node_modules\@capacitor\app"),
        .package(name: "CapacitorBrowser", path: "..\..\..\node_modules\.pnpm\@capacitor+browser@8.0.1_@capacitor+core@8.0.0\node_modules\@capacitor\browser"),
        .package(name: "CapacitorCamera", path: "..\..\..\node_modules\.pnpm\@capacitor+camera@8.0.2_@capacitor+core@8.0.0\node_modules\@capacitor\camera"),
        .package(name: "CapacitorDevice", path: "..\..\..\node_modules\.pnpm\@capacitor+device@8.0.2_@capacitor+core@8.0.0\node_modules\@capacitor\device"),
        .package(name: "CapacitorFilesystem", path: "..\..\..\node_modules\.pnpm\@capacitor+filesystem@8.1.0_@capacitor+core@8.0.0\node_modules\@capacitor\filesystem"),
        .package(name: "CapacitorKeyboard", path: "..\..\..\node_modules\.pnpm\@capacitor+keyboard@8.0.3_@capacitor+core@8.0.0\node_modules\@capacitor\keyboard"),
        .package(name: "CapacitorLocalNotifications", path: "..\..\..\node_modules\.pnpm\@capacitor+local-notifications@8.0.2_@capacitor+core@8.0.0\node_modules\@capacitor\local-notifications"),
        .package(name: "CapacitorShare", path: "..\..\..\node_modules\.pnpm\@capacitor+share@8.0.0_@capacitor+core@8.0.0\node_modules\@capacitor\share"),
        .package(name: "CapgoCapacitorNativeBiometric", path: "..\..\..\node_modules\.pnpm\@capgo+capacitor-native-bio_40b26c4cf3eea31f06c2381be8f2288b\node_modules\@capgo\capacitor-native-biometric"),
        .package(name: "SentryCapacitor", path: "..\..\..\node_modules\.pnpm\@sentry+capacitor@4.0.0_@ca_c6b794a880dea0833ca5fa2784f3e0c4\node_modules\@sentry\capacitor")
    ],
    targets: [
        .target(
            name: "CapApp-SPM",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "CapacitorApp", package: "CapacitorApp"),
                .product(name: "CapacitorBrowser", package: "CapacitorBrowser"),
                .product(name: "CapacitorCamera", package: "CapacitorCamera"),
                .product(name: "CapacitorDevice", package: "CapacitorDevice"),
                .product(name: "CapacitorFilesystem", package: "CapacitorFilesystem"),
                .product(name: "CapacitorKeyboard", package: "CapacitorKeyboard"),
                .product(name: "CapacitorLocalNotifications", package: "CapacitorLocalNotifications"),
                .product(name: "CapacitorShare", package: "CapacitorShare"),
                .product(name: "CapgoCapacitorNativeBiometric", package: "CapgoCapacitorNativeBiometric"),
                .product(name: "SentryCapacitor", package: "SentryCapacitor")
            ]
        )
    ]
)
