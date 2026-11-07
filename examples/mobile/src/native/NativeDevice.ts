// A Codegen spec, written the React Native way. React Native's Codegen turns it into
// NativeDeviceSpec: the base class of DeviceModule.kt on Android, and the protocol DeviceModule.mm
// adopts on iOS.
// mobile.modules.Device in farm.config.ts declares the VIBRATE permission vibrate() needs.
import { TurboModuleRegistry, type TurboModule } from "react-native";

export interface Spec extends TurboModule {
  /** The phone's model: `Build.MODEL` on Android, such as "Pixel 8"; the device name on iOS. */
  model(): Promise<string>;
  /** Vibrates for `ms` milliseconds. */
  vibrate(ms: number): Promise<void>;
}

export default TurboModuleRegistry.getEnforcing<Spec>("Device");
