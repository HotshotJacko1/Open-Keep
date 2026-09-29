# Open Keep release rules (C6-04). R8 shrinks and optimises the release build.
#
# The libraries bring their own keep rules (the proguard.txt in each AAR), so none
# are repeated here:
#   - Capacitor keeps every Plugin subclass and its @PluginMethod methods, which
#     covers NoteStoragePlugin and the plugins listed in capacitor.plugins.json.
#   - SQLCipher keeps net.zetetic.database.** whole, for its JNI.
#   - Room keeps RoomDatabase subclasses, which it finds by name (AppDatabase_Impl).
#   - Glance keeps ActionCallback implementations by name. It instantiates them from
#     the class name stored in a widget's PendingIntent, so ToggleCheckboxAction and
#     CollectionToggleCheckboxAction must never be renamed or moved.
# Read a library's proguard.txt before adding a rule for it here.

# No renaming. The source is public under the AGPL, so obfuscation hides nothing,
# and real names keep Sentry's Android stack traces readable without uploading a
# mapping file for every build. Shrinking and optimisation still apply.
-dontobfuscate
-keepattributes SourceFile,LineNumberTable
