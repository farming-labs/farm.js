// A Codegen spec, written the React Native way. Farm copies it into the Android project, where
// React Native's Codegen turns it into NativeDeviceSpec, the base class of DeviceModule.kt.
// mobile.modules.Device in farm.config.ts declares the VIBRATE permission vibrate() needs.
import { TurboModuleRegistry, type TurboModule } from "react-native";

export interface Spec extends TurboModule {
  /** The phone's model, `Build.MODEL` on Android, such as "Pixel 8". */
  model(): Promise<string>;
  /** Vibrates for `ms` milliseconds. */
  vibrate(ms: number): Promise<void>;
  /**
   * Opens the system photo picker and resolves with the photo's `file://` URI, or null when the
   * user backs out. Web screens get it as a `/__farm/files/<id>` URL instead, by reference.
   */
  pickPhoto(): Promise<string | null>;
}

export default TurboModuleRegistry.getEnforcing<Spec>("Device");
