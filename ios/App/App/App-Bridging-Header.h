// App-Bridging-Header.h
// This bridging header exposes the SQLCipher-specific C API to Swift.
// sqlite3_key and sqlite3_rekey are conditionally compiled under SQLITE_HAS_CODEC.
// We define that macro here before including the SQLCipher sqlite3 header so
// Swift can call them directly without a module qualifier.

#ifndef SQLITE_HAS_CODEC
#define SQLITE_HAS_CODEC 1
#endif

#import <SQLCipher/sqlite3.h>
