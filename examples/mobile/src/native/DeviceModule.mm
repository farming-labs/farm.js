// The Device module from NativeDevice.ts on iOS: the Objective-C++ twin of DeviceModule.kt.
// Codegen generates the NativeDeviceSpec protocol and its JSI glue (FarmAppSpec.h) from the spec.
#import <React/RCTUtils.h>
#import <UIKit/UIKit.h>

#import "FarmAppSpec.h"

@interface DeviceModule
    : NSObject <NativeDeviceSpec, UIImagePickerControllerDelegate, UINavigationControllerDelegate>
@end

@implementation DeviceModule {
  // The open photo picker's promise; main queue only.
  RCTPromiseResolveBlock _pickResolve;
  RCTPromiseRejectBlock _pickReject;
}

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

/// The system photo library picker, from UIKit; it runs out of process and needs no permission.
/// The photo is copied into tmp/farm-files and resolved as its file:// URL, which a native
/// screen's Image loads. iOS web screens cannot load it (file references are Android only), so the
/// example's web screen uses a file input on iOS.
- (void)pickPhoto:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self->_pickResolve) {
      reject(@"picker_open", @"A photo picker is already open.", nil);
      return;
    }
    UIViewController *presenter = RCTPresentedViewController();
    if (!presenter) {
      reject(@"no_activity", @"pickPhoto() needs the app in the foreground.", nil);
      return;
    }
    UIImagePickerController *picker = [[UIImagePickerController alloc] init];
    picker.sourceType = UIImagePickerControllerSourceTypePhotoLibrary;
    picker.delegate = self;
    self->_pickResolve = resolve;
    self->_pickReject = reject;
    [presenter presentViewController:picker animated:YES completion:nil];
  });
}

- (void)imagePickerController:(UIImagePickerController *)picker
    didFinishPickingMediaWithInfo:(NSDictionary<UIImagePickerControllerInfoKey, id> *)info
{
  [picker dismissViewControllerAnimated:YES completion:nil];
  RCTPromiseResolveBlock resolve = _pickResolve;
  RCTPromiseRejectBlock reject = _pickReject;
  _pickResolve = nil;
  _pickReject = nil;
  if (!resolve) {
    return;
  }
  NSURL *picked = info[UIImagePickerControllerImageURL];
  if (!picked) {
    reject(@"photo_unreadable", @"The photo library gave no file for this photo.", nil);
    return;
  }
  NSFileManager *files = NSFileManager.defaultManager;
  NSURL *dir = [NSURL fileURLWithPath:[NSTemporaryDirectory() stringByAppendingPathComponent:@"farm-files"]
                          isDirectory:YES];
  [files createDirectoryAtURL:dir withIntermediateDirectories:YES attributes:nil error:nil];
  NSString *extension = picked.pathExtension.length > 0 ? picked.pathExtension : @"jpg";
  NSURL *target = [dir URLByAppendingPathComponent:
      [NSString stringWithFormat:@"photo-%@.%@", NSUUID.UUID.UUIDString, extension]];
  NSError *error = nil;
  if (![files copyItemAtURL:picked toURL:target error:&error]) {
    reject(@"photo_unreadable", error.localizedDescription, error);
    return;
  }
  resolve(target.absoluteString);
}

- (void)imagePickerControllerDidCancel:(UIImagePickerController *)picker
{
  [picker dismissViewControllerAnimated:YES completion:nil];
  RCTPromiseResolveBlock resolve = _pickResolve;
  _pickResolve = nil;
  _pickReject = nil;
  if (resolve) {
    resolve(nil);
  }
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeDeviceSpecJSI>(params);
}

@end
