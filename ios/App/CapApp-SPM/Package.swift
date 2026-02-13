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
        .package(name: "CapacitorFilesystem", path: "..\..\..\node_modules\.pnpm\@capacitor+filesystem@8.1.0_@capacitor+core@8.0.0\node_modules\@capacitor\filesystem"),
        .package(name: "CapacitorShare", path: "..\..\..\node_modules\.pnpm\@capacitor+share@8.0.0_@capacitor+core@8.0.0\node_modules\@capacitor\share"),
        .package(name: "CapgoCapacitorNativeBiometric", path: "..\..\..\node_modules\.pnpm\@capgo+capacitor-native-bio_40b26c4cf3eea31f06c2381be8f2288b\node_modules\@capgo\capacitor-native-biometric")
    ],
    targets: [
        .target(
            name: "CapApp-SPM",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "CapacitorApp", package: "CapacitorApp"),
                .product(name: "CapacitorFilesystem", package: "CapacitorFilesystem"),
                .product(name: "CapacitorShare", package: "CapacitorShare"),
                .product(name: "CapgoCapacitorNativeBiometric", package: "CapgoCapacitorNativeBiometric")
            ]
        )
    ]
)
