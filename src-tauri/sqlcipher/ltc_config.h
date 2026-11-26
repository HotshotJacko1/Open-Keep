/* Copyright (c) 2026. Licensed under AGPLv3.
 *
 * The one LibTomCrypt configuration for the desktop SQLCipher build (build.rs).
 * Every SQLCipher and LibTomCrypt translation unit is compiled with this header
 * forced in, so struct layouts agree between them. Same switch set as the one
 * sqlcipher-src is tested with, minus the WebAssembly-only clock override:
 * on Windows rng_get_bytes uses CryptGenRandom and never reaches the clock.
 */
#ifndef OPEN_KEEP_LTC_CONFIG_H
#define OPEN_KEEP_LTC_CONFIG_H

#define LTC_NOTHING
#define LTC_RIJNDAEL
#define LTC_CBC_MODE
#define LTC_SHA1
#define LTC_SHA256
#define LTC_SHA512
#define LTC_HASH_HELPERS
#define LTC_HMAC
#define LTC_FORTUNA
#define LTC_PKCS_5
#define LTC_RNG_GET_BYTES
#define LTC_PRNG_ENABLE_LTC_RNG
#define LTC_NO_TEST
#define LTC_NO_FILE
#define LTC_NO_ASM
#define LTC_NO_MATH
#define LTC_CLEAN_STACK
/* Bad arguments return CRYPT_INVALID_ARG instead of aborting the process. */
#define ARGTYPE 4

#endif
