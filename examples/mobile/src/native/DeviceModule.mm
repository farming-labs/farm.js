// The Device module from NativeDevice.ts on iOS: the Objective-C++ twin of DeviceModule.kt.
// Codegen generates the NativeDeviceSpec protocol and its JSI glue (FarmAppSpec.h) from the spec.
#import <UIKit/UIKit.h>

#import "FarmAppSpec.h"

@interface DeviceModule : NSObject <NativeDeviceSpec>
@end

@implementation DeviceModule

RCT_EXPORT_MODULE(Device)

/// The phone's model, such as "iPhone"; on a simulator, the device it simulates.
- (void)model:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  NSString *simulated = NSProcessInfo.processInfo.environment[@"SIMULATOR_DEVICE_NAME"];
  resolve(simulated.length > 0 ? simulated : UIDevice.currentDevice.model);
}

/// A haptic tap. iOS plays fixed patterns, so `ms` only has to be valid, as on Android.
- (void)vibrate:(double)ms resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  if (ms < 1) {
    reject(@"invalid_duration", [NSString stringWithFormat:@"vibrate(ms) needs 1 ms or more, got %g.", ms], nil);
    return;
  }
  dispatch_async(dispatch_get_main_queue(), ^{
    UIImpactFeedbackGenerator *generator =
        [[UIImpactFeedbackGenerator alloc] initWithStyle:UIImpactFeedbackStyleMedium];
    [generator impactOccurred];
    resolve(nil);
  });
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeDeviceSpecJSI>(params);
}

@end
