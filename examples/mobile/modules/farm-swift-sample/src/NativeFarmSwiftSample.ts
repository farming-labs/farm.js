import { TurboModuleRegistry, type TurboModule } from "react-native";

export interface Spec extends TurboModule {
  /** The device's time zone, as Swift reads it, such as "Swift: Europe/Paris". */
  timeZone(): Promise<string>;
}

export default TurboModuleRegistry.get<Spec>("FarmSwiftSample");
