// OpenKeepWidget-Bridging-Header.h
// Exposes the SQLCipher-specific C API to the widget extension's Swift code,
// mirroring the main app's App-Bridging-Header.h. sqlite3_key/sqlite3_rekey are
// conditionally compiled under SQLITE_HAS_CODEC, so we define that before
// including the SQLCipher sqlite3 header. This lets the widget call sqlite3_*
// (including sqlite3_key) directly, linking against the SQLCipher package
// instead of the system SQLite, so there are no duplicate-symbol conflicts.

#ifndef SQLITE_HAS_CODEC
#define SQLITE_HAS_CODEC 1
#endif

#import <SQLCipher/sqlite3.h>
