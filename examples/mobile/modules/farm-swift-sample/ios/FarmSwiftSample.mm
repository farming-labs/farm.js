#import "FarmSwiftSample.h"

// The pod's Swift, as CocoaPods names its generated header.
#import "FarmSwiftSample-Swift.h"

@implementation FarmSwiftSample

RCT_EXPORT_MODULE()

- (void)timeZone:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [FarmSwiftSampleClock timeZone:resolve];
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeFarmSwiftSampleSpecJSI>(params);
}

@end
