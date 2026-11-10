import Foundation
// Community Swift modules import React's Objective-C API as a module, for its block types.
import React

@objc
public final class FarmSwiftSampleClock: NSObject {
    /// Answers the promise FarmSwiftSample.mm received, with React's own block type.
    @objc(timeZone:)
    public static func timeZone(_ resolve: @escaping RCTPromiseResolveBlock) {
        let zone = TimeZone.current.identifier
        // CI reads this line from the device log: the Swift code ran.
        NSLog("FarmSwiftSample answered from Swift: %@", zone)
        resolve("Swift: \(zone)")
    }
}
