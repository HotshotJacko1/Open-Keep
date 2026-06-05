#import <Capacitor/Capacitor.h>

CAP_PLUGIN(NoteStoragePlugin, "NoteStorage",
    CAP_PLUGIN_METHOD(loadNotes, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(saveNote, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(deleteNote, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(initialize, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(checkStatus, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(encrypt, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(decrypt, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(lock, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(clearAllData, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(wipeDatabaseButKeepKeys, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(migrateFromWeb, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(changeEncryptionKey, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(exportMasterKey, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(importMasterKey, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(verifyCloudMasterKeyMatch, CAPPluginReturnPromise);
)
