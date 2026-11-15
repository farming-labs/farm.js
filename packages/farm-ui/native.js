// @farm.js/ui on a React Native screen: Metro resolves `@farm.js/ui` here through the
// `react-native` export condition. The native views live in @farm.js/native, which every app with
// native screens installs and Metro resolves from the app; web builds never read this file.
export * from "@farm.js/native/ui";
