NMTS MOBILE - VERIFIED BUILD PACKAGE

IMPORTANT BEFORE BUILD
1. Copy .env.example to .env.
2. Replace the placeholder API URL with the real HTTPS NMTS mobile API URL.
3. Do not upload .env to GitHub.

INSTALL / CHECK / BUILD
npm ci
npx expo-doctor
npx eas build --platform android --profile preview --clear-cache

VERIFICATION COMPLETED
- package.json, app.json and eas.json parsed successfully.
- npm dependency installation completed successfully.
- Expo public config generation completed successfully.
- Expo Android prebuild completed successfully.
- JavaScript Metro bundling reached completion of all modules without a source/import error.
- Full native Gradle compilation could not be completed in the verification environment because Gradle's distribution server was temporarily unreachable.

NOTES
- react-native-worklets 0.8.3 is intentionally used because OCR Plus 2.0.1 requires >=0.8.0 and React Native 0.81 support is in the 0.8.x line.
- The Expo dependency checker exclusion for react-native-worklets is intentional.
