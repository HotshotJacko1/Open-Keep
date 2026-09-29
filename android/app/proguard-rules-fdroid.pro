# F-Droid flavor only (C6-04). When the social-login module is compiled into this
# flavor, its Google provider is built against Play Services as compileOnly (see
# android/build.gradle), so those classes are absent from the APK on purpose.
# The app never calls that provider on this flavor (src/lib/build-flavor.ts).
# Scoped to this flavor so the play build still fails if one of them goes missing.
-dontwarn com.google.android.gms.**
-dontwarn com.google.android.libraries.identity.googleid.**
