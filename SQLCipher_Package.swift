// swift-tools-version: 6.0
// The swift-tools-version declares the minimum version of Swift required to build this package.

import PackageDescription

let package = Package(
    name: "SQLCipher",
    platforms: [
        .iOS(.v12),
        .macOS(.v10_13),
        .macCatalyst(.v13),
        .watchOS(.v4),
        .tvOS(.v12),
        .visionOS(.v1)
    ],
    products: [
        .library(
            name: "SQLCipher",
            targets: ["SQLCipher"]),
    ],
    targets: [
        .binaryTarget(name: "SQLCipher",
                      url: "https://github.com/sqlcipher/SQLCipher.swift/releases/download/4.16.0/SQLCipher.xcframework.zip",
                      checksum: "510fd00fa51fb017909a159bb1cc233b012e8ce18dc9c2f09014fe47f557c1a6"
                     ),
        .testTarget(
            name: "SQLCipherTests",
            dependencies: ["SQLCipher"],
            cSettings: [
                .define("SQLITE_HAS_CODEC", to: nil)
            ]
        )
    ]
)
