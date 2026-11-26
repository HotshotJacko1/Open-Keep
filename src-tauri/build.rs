// Copyright (c) 2026. Licensed under AGPLv3.
//
// Builds SQLCipher for the desktop notes database (src/storage) with LibTomCrypt
// as its crypto provider, so the build needs no OpenSSL (and no Perl to build
// one). rusqlite's own `bundled-sqlcipher` feature only knows OpenSSL on Windows.
//
// The library is named `sqlite3` on purpose: without a bundled feature,
// libsqlite3-sys just asks the linker for `sqlite3`, and gets this one.
// .cargo/config.toml stops it finding a system SQLite through vcpkg first.

use std::path::Path;

fn main() {
    // Any rerun-if-changed line (build_sqlcipher prints one) makes Cargo rerun
    // this script only for the files listed, so the icons tauri_build embeds
    // in the exe need listing too, or a new icon set never reaches the build.
    println!("cargo:rerun-if-changed=icons");
    build_sqlcipher();
    tauri_build::build()
}

fn build_sqlcipher() {
    let src = sqlcipher_src::source_dir();
    let tomcrypt_include = src.join(sqlcipher_src::LIBTOMCRYPT_INCLUDE_DIR);
    let config = Path::new(env!("CARGO_MANIFEST_DIR")).join("sqlcipher").join("ltc_config.h");
    println!("cargo:rerun-if-changed={}", config.display());
    let config = config.as_path();

    let force_include = |build: &mut cc::Build| {
        if build.get_compiler().is_like_msvc() {
            build.flag(format!("/FI{}", config.display()));
        } else {
            build.flag("-include").flag(config.to_str().unwrap());
        }
    };

    let mut sqlite = cc::Build::new();
    sqlite
        .file(src.join(sqlcipher_src::SOURCE_FILE))
        .include(src)
        .include(&tomcrypt_include)
        .define("SQLITE_HAS_CODEC", "1")
        .define("SQLCIPHER_CRYPTO_LIBTOMCRYPT", "1")
        .define("SQLITE_EXTRA_INIT", "sqlcipher_extra_init")
        .define("SQLITE_EXTRA_SHUTDOWN", "sqlcipher_extra_shutdown")
        .define("SQLITE_THREADSAFE", "1")
        // SQLCipher's recommendation: temporary tables and indices never touch disk.
        .define("SQLITE_TEMP_STORE", "2")
        .define("SQLITE_DQS", "0")
        .define("SQLCIPHER_OMIT_LOG_DEVICE", "1")
        .warnings(false);
    force_include(&mut sqlite);
    sqlite.compile("sqlite3");

    let mut ltc = cc::Build::new();
    ltc.include(&tomcrypt_include)
        .define("LTC_SOURCE", None)
        .files(sqlcipher_src::LIBTOMCRYPT_SOURCES.iter().map(|s| src.join(s)))
        .warnings(false);
    force_include(&mut ltc);
    ltc.compile("sqlcipher_ltc");

    // CryptGenRandom, which LibTomCrypt's rng_get_bytes uses on Windows.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        println!("cargo:rustc-link-lib=advapi32");
    }
}
